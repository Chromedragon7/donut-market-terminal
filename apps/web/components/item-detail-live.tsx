'use client';

import { useEffect, useState } from 'react';
import { Activity, BadgeDollarSign, CircleDollarSign, PackageSearch } from 'lucide-react';
import Link from '@/components/safe-link';

import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

const apiOrigin = process.env.NEXT_PUBLIC_API_ORIGIN ?? '';

interface ItemDetail {
  id: string;
  baseItemId: string;
  displayName: string;
  variantLabel: string | null;
  identityState: string;
  lowestAsk: string | null;
  recentSaleMedian: string | null;
  recordedSaleCount: number;
  activeListingCount: number;
  quality: { freshness: string; confidence: string; sampleSize: number | null; flags: string[] };
}

type State =
  | { status: 'loading' }
  | { status: 'ready'; item: ItemDetail }
  | { status: 'unauthorized' | 'not_found' | 'offline' };

function exactDisplay(value: string | null): string {
  if (value === null) return '—';
  const [whole = value, fraction] = value.split('.');
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${fraction === undefined ? '' : `.${fraction}`}`;
}

export function ItemDetailLive({ itemId }: { itemId: string }) {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`${apiOrigin}/v1/items/${encodeURIComponent(itemId)}`, {
      credentials: 'include',
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 401) return setState({ status: 'unauthorized' });
        if (response.status === 404) return setState({ status: 'not_found' });
        if (!response.ok) throw new Error('item unavailable');
        setState({ status: 'ready', item: (await response.json()) as ItemDetail });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setState({ status: 'offline' });
      });
    return () => controller.abort();
  }, [itemId]);

  if (state.status !== 'ready') {
    const copy = {
      loading: ['Loading item evidence…', 'The private API is resolving this identity.'],
      unauthorized: ['Sign in to view item evidence', 'Market records are private by default.'],
      not_found: ['No confirmed catalog record', 'This identifier has not appeared in validated source data.'],
      offline: ['The hosted API is unavailable', 'Retained data will reappear when the service is reachable.'],
    }[state.status];
    return (
      <Card className="border border-white/[0.03] bg-card/80 sm:col-span-2 xl:col-span-4">
        <CardContent className="flex min-h-28 flex-col items-center justify-center p-5 text-center">
          <p className="text-sm font-medium">{copy[0]}</p>
          <p className="mt-1 text-xs text-muted-foreground">{copy[1]}</p>
          {state.status === 'unauthorized' ? <Link href="/login" className={`${buttonVariants({ size: 'sm' })} mt-4`}>Sign in</Link> : null}
        </CardContent>
      </Card>
    );
  }

  const { item } = state;
  const metrics = [
    ['Lowest current ask', exactDisplay(item.lowestAsk), `${item.activeListingCount} observed listings`, PackageSearch],
    ['Recent sale median', exactDisplay(item.recentSaleMedian), `Sample: ${item.quality.sampleSize ?? 0}`, BadgeDollarSign],
    ['Recorded trades', item.recordedSaleCount.toLocaleString(), 'Recorded, not claimed total', Activity],
    ['Identity quality', item.identityState, `Confidence: ${item.quality.confidence}`, CircleDollarSign],
  ] as const;

  return (
    <>
      {metrics.map(([label, value, detail, Icon]) => (
        <Card key={label} className="border border-white/[0.03] bg-card/80 py-4">
          <CardContent className="px-4">
            <div className="flex items-center justify-between"><p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">{label}</p><Icon className="size-4 text-emerald-300" /></div>
            <p className="mt-2 truncate font-mono text-xl font-semibold">{value}</p>
            <div className="mt-2 flex items-center justify-between gap-2"><p className="text-xs text-muted-foreground">{detail}</p>{label === 'Identity quality' ? <Badge variant="outline" className="text-[10px]">{item.quality.freshness}</Badge> : null}</div>
          </CardContent>
        </Card>
      ))}
    </>
  );
}
