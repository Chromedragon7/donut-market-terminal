'use client';

import { useCallback, useEffect, useState } from 'react';
import { Activity, CircleDollarSign, Database, PackageSearch } from 'lucide-react';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

const apiOrigin = process.env.NEXT_PUBLIC_API_ORIGIN ?? '';

interface MarketOverview {
  generatedAt: string;
  activeAsks: { listingCount: number; listedQuantity: number };
  completedSales: {
    recordedTradeCount24h: number;
    recordedQuantity24h: number;
    recordedTurnover24h: string;
  };
  priceUnit: 'server_currency';
  quality: {
    freshness: 'live' | 'recent' | 'stale' | 'unknown';
    confidence: 'high' | 'medium' | 'low' | 'unknown';
    sampleSize: number | null;
    completeness: 'complete_observation' | 'partial' | 'unknown';
    flags: string[];
  };
}

type State =
  | { status: 'loading' }
  | { status: 'ready'; value: MarketOverview }
  | { status: 'unauthorized' }
  | { status: 'offline' };

function formatExactDecimal(value: string): string {
  const match = /^(-?)(\d+)(\.\d+)?$/.exec(value);
  if (!match) return value;
  const [, sign, whole, fraction = ''] = match;
  return `${sign}${whole?.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${fraction}`;
}

export function LiveOverviewMetrics() {
  const [state, setState] = useState<State>({ status: 'loading' });

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch(`${apiOrigin}/v1/market/overview`, {
        credentials: 'include',
        cache: 'no-store',
        signal,
      });
      if (response.status === 401) {
        setState({ status: 'unauthorized' });
        return;
      }
      if (!response.ok) throw new Error('overview unavailable');
      setState({ status: 'ready', value: (await response.json()) as MarketOverview });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setState({ status: 'offline' });
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);

    const stream = new EventSource(`${apiOrigin}/v1/stream`, { withCredentials: true });
    for (const event of ['market.summary', 'listing.changed', 'sale.recorded']) {
      stream.addEventListener(event, () => void refresh());
    }

    return () => {
      controller.abort();
      stream.close();
    };
  }, [refresh]);

  if (state.status === 'unauthorized') {
    return (
      <Card className="border border-amber-300/20 bg-amber-300/[0.04] sm:col-span-2 xl:col-span-4">
        <CardContent className="flex flex-col justify-between gap-4 p-4 sm:flex-row sm:items-center">
          <div>
            <p className="text-sm font-medium">Sign in to load private market measurements</p>
            <p className="mt-1 text-xs text-muted-foreground">The API does not expose market data to anonymous browsers.</p>
          </div>
          <Link href="/login" className={buttonVariants({ size: 'sm' })}>Sign in</Link>
        </CardContent>
      </Card>
    );
  }

  const value = state.status === 'ready' ? state.value : null;
  const metrics = [
    {
      label: 'Observed active asks',
      value: value ? value.activeAsks.listingCount.toLocaleString() : '—',
      detail: value ? `${value.activeAsks.listedQuantity.toLocaleString()} listed units` : 'No active-listing observation loaded',
      icon: PackageSearch,
      tone: 'text-emerald-300',
    },
    {
      label: 'Recorded trades · 24h',
      value: value ? value.completedSales.recordedTradeCount24h.toLocaleString() : '—',
      detail: 'Completed sales only; never active asks',
      icon: Activity,
      tone: 'text-amber-300',
    },
    {
      label: 'Recorded quantity · 24h',
      value: value ? value.completedSales.recordedQuantity24h.toLocaleString() : '—',
      detail: 'Recorded volume may not equal total volume',
      icon: Database,
      tone: 'text-sky-300',
    },
    {
      label: 'Recorded turnover · 24h',
      value: value ? formatExactDecimal(value.completedSales.recordedTurnover24h) : '—',
      detail: value ? `Source freshness: ${value.quality.freshness}` : state.status === 'offline' ? 'Hosted API is unavailable' : 'Loading private API',
      icon: CircleDollarSign,
      tone: 'text-violet-300',
    },
  ];

  return (
    <>
      {metrics.map(({ label, value: metricValue, detail, icon: Icon, tone }) => (
        <Card key={label} className="gap-3 border border-white/[0.03] bg-card/80 py-4 shadow-[0_14px_42px_rgb(0_0_0/16%)]">
          <CardContent className="px-4">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-medium uppercase tracking-[0.13em] text-muted-foreground">{label}</p>
              <Icon className={`size-4 ${tone}`} aria-hidden="true" />
            </div>
            <p className="mt-3 font-mono text-xl font-semibold tracking-tight">{metricValue}</p>
            <div className="mt-2 flex items-start justify-between gap-2">
              <p className="text-xs leading-5 text-muted-foreground">{detail}</p>
              {value ? <Badge variant="outline" className="shrink-0 text-[10px]">{value.quality.confidence}</Badge> : null}
            </div>
          </CardContent>
        </Card>
      ))}
    </>
  );
}
