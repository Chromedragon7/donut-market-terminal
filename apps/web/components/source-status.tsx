'use client';

import { useEffect, useState } from 'react';
import { CircleAlert, Gauge, LockKeyhole, ShieldCheck, TriangleAlert, WifiOff } from 'lucide-react';
import Link from '@/components/safe-link';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const apiOrigin = process.env.NEXT_PUBLIC_API_ORIGIN ?? '';

interface SourceHealth {
  id: string;
  displayName: string;
  enabled: boolean;
  trust: string;
  status: 'healthy' | 'degraded' | 'stale' | 'offline' | 'disabled' | 'unknown';
  lastSuccessAt: string | null;
  requestLatencyMs: number | null;
  freshness: string;
}

interface Feature {
  id: string;
  state: 'available' | 'disabled' | 'unavailable' | 'unknown';
  reason: string;
  checkedAt: string;
}

type State =
  | { status: 'loading'; sources: SourceHealth[]; features: Feature[] }
  | { status: 'ready'; sources: SourceHealth[]; features: Feature[] }
  | { status: 'unauthorized' | 'offline'; sources: []; features: [] };

function dateLabel(value: string | null): string {
  return value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Never';
}

function loadState(setState: (state: State) => void): () => void {
  const controller = new AbortController();
  void Promise.all([
    fetch(`${apiOrigin}/v1/sources`, { credentials: 'include', cache: 'no-store', signal: controller.signal }),
    fetch(`${apiOrigin}/v1/features`, { credentials: 'include', cache: 'no-store', signal: controller.signal }),
  ]).then(async ([sourcesResponse, featuresResponse]) => {
    if (sourcesResponse.status === 401 || featuresResponse.status === 401) return setState({ status: 'unauthorized', sources: [], features: [] });
    if (!sourcesResponse.ok || !featuresResponse.ok) throw new Error('status unavailable');
    const [sourcePayload, featurePayload] = await Promise.all([
      sourcesResponse.json() as Promise<{ sources: SourceHealth[] }>,
      featuresResponse.json() as Promise<{ features: Feature[] }>,
    ]);
    setState({ status: 'ready', sources: sourcePayload.sources, features: featurePayload.features });
  }).catch((error: unknown) => {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    setState({ status: 'offline', sources: [], features: [] });
  });
  return () => controller.abort();
}

export function CollectorStatusBanner() {
  const [state, setState] = useState<State>({ status: 'loading', sources: [], features: [] });
  useEffect(() => loadState(setState), []);
  const active = state.sources.find((source) => source.enabled);
  const healthy = active?.status === 'healthy';

  if (state.status === 'ready' && healthy) return <Alert className="mt-6 border-emerald-300/20 bg-emerald-300/[0.045] px-3 py-3"><ShieldCheck className="mt-0.5 text-emerald-300" /><AlertTitle>Collector source is healthy</AlertTitle><AlertDescription className="text-muted-foreground">{active.displayName} last succeeded {dateLabel(active.lastSuccessAt)}. Browser updates are fanned out by the hosted API.</AlertDescription></Alert>;
  if (state.status === 'unauthorized') return <Alert className="mt-6 border-sky-300/20 bg-sky-300/[0.04] px-3 py-3"><LockKeyhole className="mt-0.5 text-sky-300" /><AlertTitle>Private market workspace</AlertTitle><AlertDescription className="text-muted-foreground">Sign in to view retained source evidence. <Link href="/login" className="underline decoration-border underline-offset-4">Open sign in</Link>.</AlertDescription></Alert>;
  if (state.status === 'offline') return <Alert className="mt-6 border-rose-300/20 bg-rose-300/[0.04] px-3 py-3"><WifiOff className="mt-0.5 text-rose-300" /><AlertTitle>Hosted API is unavailable</AlertTitle><AlertDescription className="text-muted-foreground">The browser never falls back to the upstream source. Retained data will return when the private API recovers.</AlertDescription></Alert>;
  return <Alert className="mt-6 border-amber-300/25 bg-amber-300/[0.055] px-3 py-3 text-amber-50"><CircleAlert className="mt-0.5 text-amber-300" /><AlertTitle>{state.status === 'loading' ? 'Checking collector source' : 'Collector source needs attention'}</AlertTitle><AlertDescription className="text-amber-100/65">{active ? `${active.displayName} reports ${active.status}; last success ${dateLabel(active.lastSuccessAt)}.` : 'No enabled compatible source is reporting health yet. Configure the collector through server-side secrets.'}</AlertDescription></Alert>;
}

export function SourceFeaturePanel() {
  const [state, setState] = useState<State>({ status: 'loading', sources: [], features: [] });
  useEffect(() => loadState(setState), []);
  const active = state.sources.find((source) => source.enabled) ?? state.sources[0];
  return <>
    <Card className="border border-white/[0.03] bg-card/80"><CardHeader><CardTitle>Source health</CardTitle><CardDescription>Freshness is measured at every stage.</CardDescription></CardHeader><CardContent className="space-y-4">{active ? <><div className="flex items-start justify-between gap-4"><div className="flex gap-3"><span className="mt-0.5 grid size-8 place-items-center rounded-lg bg-emerald-300/[0.08]"><Gauge className="size-4 text-emerald-300" /></span><div><p className="text-sm font-medium">{active.displayName}</p><p className="mt-0.5 text-xs text-muted-foreground">Trust: {active.trust}</p></div></div><Badge variant="outline">{active.status}</Badge></div><div className="h-px bg-border/70" /><dl className="grid grid-cols-2 gap-3 text-xs"><div><dt className="text-muted-foreground">Last success</dt><dd className="mt-1 font-mono">{dateLabel(active.lastSuccessAt)}</dd></div><div><dt className="text-muted-foreground">Latency</dt><dd className="mt-1 font-mono">{active.requestLatencyMs === null ? 'Unknown' : `${active.requestLatencyMs} ms`}</dd></div><div><dt className="text-muted-foreground">Freshness</dt><dd className="mt-1 font-mono">{active.freshness}</dd></div><div><dt className="text-muted-foreground">Enabled</dt><dd className="mt-1 font-mono">{active.enabled ? 'Yes' : 'No'}</dd></div></dl></> : <div className="grid min-h-28 place-items-center text-center"><div><p className="text-sm font-medium">{state.status === 'loading' ? 'Checking source…' : state.status === 'unauthorized' ? 'Sign in required' : 'No source health available'}</p>{state.status === 'unauthorized' ? <Link href="/login" className={`${buttonVariants({ size: 'sm' })} mt-3`}>Sign in</Link> : null}</div></div>}</CardContent></Card>
    <Card className="border border-white/[0.03] bg-card/80"><CardHeader><CardTitle>Feature availability</CardTitle><CardDescription>Unsupported data is never estimated as fact.</CardDescription></CardHeader><CardContent className="space-y-3 text-xs">{state.features.length ? state.features.map((feature) => <div key={feature.id} className="flex items-center justify-between gap-3" title={feature.reason}><span className="flex items-center gap-2">{feature.state === 'available' ? <ShieldCheck className="size-3.5 text-emerald-300" /> : <TriangleAlert className="size-3.5 text-muted-foreground" />}{feature.id.replaceAll('_', ' ')}</span><Badge variant="outline" className={feature.state === 'available' ? 'text-emerald-200' : 'text-muted-foreground'}>{feature.state}</Badge></div>) : <p className="text-muted-foreground">{state.status === 'loading' ? 'Checking feature providers…' : 'Feature states unavailable'}</p>}</CardContent></Card>
  </>;
}
