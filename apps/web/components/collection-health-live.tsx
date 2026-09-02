'use client';

import { useCallback, useEffect, useState } from 'react';
import { Activity, Clock3, DatabaseZap, Gauge } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';

const apiOrigin = process.env.NEXT_PUBLIC_API_ORIGIN ?? '';

interface CollectionHealth {
  generatedAt: string;
  collectorUptimeSeconds: number | null;
  lastSuccessfulRequestAt: string | null;
  transactionWindowOldestAt: string | null;
  requestsPerMinute: number | null;
  historicalGapCount: number;
  upstreamErrors24h: number;
  workerDelayMs: number | null;
  backupState: 'healthy' | 'overdue' | 'failed' | 'unknown';
}

function elapsed(seconds: number | null): string {
  if (seconds === null) return 'Unknown';
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

function dateLabel(value: string | null): string {
  return value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Never';
}

export function CollectionHealthLive() {
  const [health, setHealth] = useState<CollectionHealth | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'unauthorized' | 'offline'>('loading');

  const load = useCallback(async () => {
    try {
      const response = await fetch(`${apiOrigin}/v1/collection-health`, { credentials: 'include', cache: 'no-store' });
      if (response.status === 401 || response.status === 403) return setState('unauthorized');
      if (!response.ok) throw new Error('unavailable');
      setHealth((await response.json()) as CollectionHealth);
      setState('ready');
    } catch {
      setState('offline');
    }
  }, []);

  useEffect(() => { void load(); const timer = window.setInterval(() => void load(), 30_000); return () => window.clearInterval(timer); }, [load]);

  const cards = health ? [
    ['Collector uptime', elapsed(health.collectorUptimeSeconds), `${health.upstreamErrors24h} upstream errors / 24h`, Activity, 'text-slate-300'],
    ['Last source success', dateLabel(health.lastSuccessfulRequestAt), `Worker delay: ${health.workerDelayMs === null ? 'unknown' : `${health.workerDelayMs} ms`}`, Clock3, 'text-amber-300'],
    ['Requests / minute', health.requestsPerMinute === null ? 'Unknown' : String(health.requestsPerMinute), `Backup state: ${health.backupState}`, Gauge, 'text-emerald-300'],
    ['Transaction window', dateLabel(health.transactionWindowOldestAt), `${health.historicalGapCount} recorded gaps`, DatabaseZap, 'text-sky-300'],
  ] as const : [
    ['Collector uptime', state === 'loading' ? 'Loading…' : state === 'unauthorized' ? 'Sign in' : 'Unavailable', state === 'unauthorized' ? 'Owner access required' : 'No live health response', Activity, 'text-slate-300'],
    ['Last source success', 'Unknown', 'No authenticated response', Clock3, 'text-amber-300'],
    ['Requests / minute', 'Unknown', 'Budget state unavailable', Gauge, 'text-emerald-300'],
    ['Transaction window', 'Unknown', 'Continuity not measured', DatabaseZap, 'text-sky-300'],
  ] as const;

  return <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{cards.map(([label, value, detail, Icon, tone]) => <Card key={label} className="border border-white/[0.03] bg-card/80 py-4"><CardContent className="px-4"><div className="flex items-center justify-between"><p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">{label}</p><Icon className={`size-4 ${tone}`} aria-hidden="true" /></div><p className="mt-3 font-mono text-lg font-semibold">{value}</p><p className="mt-2 text-xs text-muted-foreground">{detail}</p></CardContent></Card>)}</div>;
}
