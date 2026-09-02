'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChartNoAxesCombined, CircleAlert, PackageOpen, ReceiptText } from 'lucide-react';
import Link from '@/components/safe-link';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const apiOrigin = process.env.NEXT_PUBLIC_API_ORIGIN ?? '';

type RangeKey = '24h' | '7d' | '30d' | 'all';

interface Quality {
  freshness: string;
  confidence: string;
  sampleSize: number | null;
  flags: string[];
}

interface Provenance {
  sourceId: string;
  sourceType: string;
  observedAt: string;
  sourceTimestamp: string | null;
}

interface HistoryPoint {
  start: string;
  median: string | null;
  lowestAsk: string | null;
  tradeCount: number;
  recordedQuantity: number;
  gap: boolean;
  quality: Quality;
  provenance: Provenance[];
}

interface ListingRecord {
  id: string;
  quantity: number;
  totalAsk: string;
  unitAsk: string;
  observedAt: string;
  remainingSeconds: number | null;
  seller: { name: string | null; uuid: string | null };
  provenance: Provenance;
  quality: Quality;
}

interface SaleRecord {
  id: string;
  quantity: number;
  totalSale: string;
  unitSale: string;
  soldAt: string;
  seller: { name: string | null; uuid: string | null };
  provenance: Provenance;
  quality: Quality;
}

interface EvidencePayload {
  history: HistoryPoint[];
  listings: ListingRecord[];
  sales: SaleRecord[];
}

interface ChartPoint extends HistoryPoint {
  salePlot: number | null;
  askPlot: number | null;
}

type EvidenceState =
  | { status: 'loading'; data: EvidencePayload | null }
  | { status: 'ready'; data: EvidencePayload }
  | { status: 'unauthorized' | 'not_found' | 'offline'; data: null };

const ranges: Record<RangeKey, { label: string; durationMs: number | null; interval: string }> = {
  '24h': { label: '24H', durationMs: 86_400_000, interval: 'hour' },
  '7d': { label: '7D', durationMs: 7 * 86_400_000, interval: 'hour' },
  '30d': { label: '30D', durationMs: 30 * 86_400_000, interval: 'day' },
  all: { label: 'ALL', durationMs: null, interval: 'week' },
};

function exactDisplay(value: string | null): string {
  if (value === null) return '—';
  const match = /^(-?)(\d+)(\.\d+)?$/.exec(value);
  if (!match) return value;
  return `${match[1]}${match[2]?.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${match[3] ?? ''}`;
}

function dateLabel(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function normalizeExactDecimals(values: Array<string | null>): Array<number | null> {
  const parsed = values.map((value) => {
    if (value === null) return null;
    const match = /^(\d+)(?:\.(\d+))?$/.exec(value);
    if (!match) return null;
    const fraction = match[2] ?? '';
    return { digits: BigInt(`${match[1]}${fraction}`), scale: fraction.length };
  });
  const present = parsed.filter((value): value is NonNullable<typeof value> => value !== null);
  if (present.length === 0) return values.map(() => null);
  const maxScale = Math.max(...present.map((value) => value.scale));
  const scaled = parsed.map((value) => value === null ? null : value.digits * (BigInt(10) ** BigInt(maxScale - value.scale)));
  const exact = scaled.filter((value): value is bigint => value !== null);
  const minimum = exact.reduce((left, right) => left < right ? left : right);
  const maximum = exact.reduce((left, right) => left > right ? left : right);
  if (minimum === maximum) return scaled.map((value) => value === null ? null : 0.5);
  return scaled.map((value) => value === null ? null : Number((value - minimum) * BigInt(1_000_000) / (maximum - minimum)) / 1_000_000);
}

function chartPoints(points: HistoryPoint[]): ChartPoint[] {
  const values = points.flatMap((point) => [point.median, point.lowestAsk]);
  const normalized = normalizeExactDecimals(values);
  return points.map((point, index) => ({
    ...point,
    salePlot: point.gap ? null : normalized[index * 2] ?? null,
    askPlot: point.gap ? null : normalized[index * 2 + 1] ?? null,
  }));
}

function EvidenceTooltip({ active, payload }: { active?: boolean; payload?: ReadonlyArray<{ payload?: unknown }> }) {
  if (!active || !payload?.length) return null;
  const candidate = payload[0]?.payload;
  if (typeof candidate !== 'object' || candidate === null || !('start' in candidate)) return null;
  const point = candidate as ChartPoint;
  const sourceIds = [...new Set(point.provenance.map((value) => value.sourceId))];
  return <div className="max-w-64 rounded-lg border border-border bg-background/95 p-3 text-xs shadow-xl"><p className="font-medium">{dateLabel(point.start)}</p><dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1"><dt className="text-emerald-200">Sale median</dt><dd className="font-mono">{exactDisplay(point.median)}</dd><dt className="text-amber-200">Lowest ask</dt><dd className="font-mono">{exactDisplay(point.lowestAsk)}</dd><dt className="text-muted-foreground">Recorded trades</dt><dd className="font-mono">{point.tradeCount}</dd><dt className="text-muted-foreground">Confidence</dt><dd>{point.quality.confidence}</dd></dl><p className="mt-2 truncate text-[10px] text-muted-foreground">Source: {sourceIds.join(', ') || 'derived from retained evidence'}</p></div>;
}

export function ItemMarketEvidence({ itemId }: { itemId: string }) {
  const [range, setRange] = useState<RangeKey>('7d');
  const [state, setState] = useState<EvidenceState>({ status: 'loading', data: null });

  useEffect(() => {
    const controller = new AbortController();
    const now = new Date();
    const selection = ranges[range];
    const from = selection.durationMs === null ? new Date(0) : new Date(now.valueOf() - selection.durationMs);
    const historyParams = new URLSearchParams({
      from: from.toISOString(), to: now.toISOString(), interval: selection.interval, includeOutliers: 'false',
    });
    setState((current) => ({ status: 'loading', data: current.status === 'ready' ? current.data : null }));
    void Promise.all([
      fetch(`${apiOrigin}/v1/items/${encodeURIComponent(itemId)}/history?${historyParams}`, { credentials: 'include', cache: 'no-store', signal: controller.signal }),
      fetch(`${apiOrigin}/v1/items/${encodeURIComponent(itemId)}/listings?limit=12`, { credentials: 'include', cache: 'no-store', signal: controller.signal }),
      fetch(`${apiOrigin}/v1/items/${encodeURIComponent(itemId)}/sales?limit=12`, { credentials: 'include', cache: 'no-store', signal: controller.signal }),
    ]).then(async ([historyResponse, listingResponse, salesResponse]) => {
      if ([historyResponse, listingResponse, salesResponse].some((response) => response.status === 401)) return setState({ status: 'unauthorized', data: null });
      if ([historyResponse, listingResponse, salesResponse].some((response) => response.status === 404)) return setState({ status: 'not_found', data: null });
      if (!historyResponse.ok || !listingResponse.ok || !salesResponse.ok) throw new Error('evidence unavailable');
      const [history, listings, sales] = await Promise.all([
        historyResponse.json() as Promise<{ points: HistoryPoint[] }>,
        listingResponse.json() as Promise<{ items: ListingRecord[] }>,
        salesResponse.json() as Promise<{ items: SaleRecord[] }>,
      ]);
      setState({ status: 'ready', data: { history: history.points, listings: listings.items, sales: sales.items } });
    }).catch((error: unknown) => {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setState({ status: 'offline', data: null });
    });
    return () => controller.abort();
  }, [itemId, range]);

  const points = useMemo(() => chartPoints(state.data?.history ?? []), [state.data]);

  if (state.status === 'unauthorized') return <Card className="mt-5 border border-amber-300/20 bg-card/80"><CardContent className="grid min-h-64 place-items-center text-center"><div><p className="text-sm font-medium">Sign in to inspect private market evidence</p><Link href="/login" className={`${buttonVariants({ size: 'sm' })} mt-4`}>Sign in</Link></div></CardContent></Card>;
  if (state.status === 'offline' || state.status === 'not_found') return <Card className="mt-5 border border-white/[0.03] bg-card/80"><CardContent className="grid min-h-64 place-items-center text-center"><div><p className="text-sm font-medium">{state.status === 'not_found' ? 'No confirmed item evidence' : 'The hosted API is unavailable'}</p><p className="mt-1 text-xs text-muted-foreground">No values are synthesized for this view.</p></div></CardContent></Card>;

  const data = state.data;
  return (
    <div className="mt-5 space-y-5">
      <Card className="border border-white/[0.03] bg-card/80">
        <CardHeader><CardTitle>Price evidence</CardTitle><CardDescription>Completed-sale median and lowest active ask remain separate. Vertical positions are normalized from exact decimals; hover values preserve the source strings.</CardDescription><div className="flex gap-1 pt-2">{(Object.keys(ranges) as RangeKey[]).map((key) => <Button key={key} size="xs" variant={range === key ? 'secondary' : 'ghost'} className="font-mono" onClick={() => setRange(key)}>{ranges[key].label}</Button>)}</div></CardHeader>
        <CardContent>
          {points.length === 0 ? <div className="market-grid grid min-h-72 place-items-center rounded-lg border border-border bg-black/10 px-6 text-center"><div><ChartNoAxesCombined className="mx-auto size-5 text-muted-foreground" /><p className="mt-3 text-sm font-medium">{state.status === 'loading' ? 'Loading retained history…' : 'No verified observations in this range'}</p><p className="mt-1 text-xs text-muted-foreground">History begins only after collection starts.</p></div></div> : <div className="h-80 w-full" aria-label="Normalized completed-sale median and lowest-ask history chart"><ResponsiveContainer width="100%" height="100%"><LineChart data={points} margin={{ top: 16, right: 12, bottom: 6, left: 12 }}><CartesianGrid stroke="rgba(148,163,184,0.12)" vertical={false} /><XAxis dataKey="start" tickFormatter={(value: string) => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(value))} tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={false} tickLine={false} minTickGap={30} /><YAxis hide domain={[0, 1]} /><Tooltip content={<EvidenceTooltip />} /><Line type="monotone" dataKey="salePlot" name="Completed-sale median" stroke="#6ee7b7" strokeWidth={2} dot={false} connectNulls={false} /><Line type="monotone" dataKey="askPlot" name="Lowest active ask" stroke="#fcd34d" strokeWidth={1.5} strokeDasharray="5 4" dot={false} connectNulls={false} />{points.filter((point) => point.gap).map((point) => <ReferenceLine key={point.start} x={point.start} stroke="#fb7185" strokeDasharray="3 3" />)}</LineChart></ResponsiveContainer></div>}
          <div className="mt-3 flex flex-wrap gap-4 text-[10px] uppercase tracking-wider text-muted-foreground"><span className="flex items-center gap-2"><span className="h-px w-5 bg-emerald-300" />Completed-sale median</span><span className="flex items-center gap-2"><span className="h-px w-5 border-t border-dashed border-amber-300" />Lowest active ask</span><span className="flex items-center gap-2"><span className="h-3 border-l border-dashed border-rose-300" />Recorded gap</span></div>
        </CardContent>
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card className="border border-white/[0.03] bg-card/80"><CardHeader><CardTitle className="flex items-center gap-2"><PackageOpen className="size-4 text-amber-300" />Active asking prices</CardTitle><CardDescription>A low ask may no longer be available. These are observations, not completed trades.</CardDescription></CardHeader><CardContent>{data?.listings.length ? <div className="divide-y divide-border/70">{data.listings.map((listing) => <div key={listing.id} className="grid grid-cols-[1fr_auto] gap-3 py-3 first:pt-0"><div><p className="font-mono text-sm">{exactDisplay(listing.totalAsk)} total · {exactDisplay(listing.unitAsk)} / item</p><p className="mt-1 text-[11px] text-muted-foreground">Qty {listing.quantity} · observed {dateLabel(listing.observedAt)} · {listing.provenance.sourceId}</p></div><Badge variant="outline" className="h-fit">{listing.quality.confidence}</Badge></div>)}</div> : <div className="grid min-h-40 place-items-center text-center"><div><PackageOpen className="mx-auto size-5 text-muted-foreground" /><p className="mt-3 text-sm font-medium">No active asks retained</p></div></div>}</CardContent></Card>
        <Card className="border border-white/[0.03] bg-card/80"><CardHeader><CardTitle className="flex items-center gap-2"><ReceiptText className="size-4 text-emerald-300" />Recorded completed sales</CardTitle><CardDescription>Recorded volume may not equal true total market volume. No buyer data is available.</CardDescription></CardHeader><CardContent>{data?.sales.length ? <div className="divide-y divide-border/70">{data.sales.map((sale) => <div key={sale.id} className="grid grid-cols-[1fr_auto] gap-3 py-3 first:pt-0"><div><p className="font-mono text-sm">{exactDisplay(sale.totalSale)} total · {exactDisplay(sale.unitSale)} / item</p><p className="mt-1 text-[11px] text-muted-foreground">Qty {sale.quantity} · sold {dateLabel(sale.soldAt)} · {sale.provenance.sourceId}</p></div><Badge variant="outline" className="h-fit">{sale.quality.confidence}</Badge></div>)}</div> : <div className="grid min-h-40 place-items-center text-center"><div><ReceiptText className="mx-auto size-5 text-muted-foreground" /><p className="mt-3 text-sm font-medium">No completed sales retained</p></div></div>}</CardContent></Card>
      </div>

      <Card className="border border-amber-300/15 bg-amber-300/[0.035]"><CardContent className="flex gap-3 p-4 text-xs leading-5 text-muted-foreground"><CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-300" />Special items stay separate when enchantments, lore, contents, trim, potion, or server metadata is incomplete. Display filters never delete retained evidence.</CardContent></Card>
    </div>
  );
}
