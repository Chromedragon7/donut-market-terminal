'use client';

import { useEffect, useState } from 'react';
import { Boxes, Search } from 'lucide-react';
import Link from '@/components/safe-link';

import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

const apiOrigin = process.env.NEXT_PUBLIC_API_ORIGIN ?? '';

interface ItemSummary {
  id: string;
  baseItemId: string;
  displayName: string;
  variantLabel: string | null;
  identityState: 'exact' | 'strong' | 'broad' | 'incomplete' | 'ambiguous' | 'unclassified';
  lowestAsk: string | null;
  recentSaleMedian: string | null;
  quality: { freshness: string; confidence: string; sampleSize: number | null; flags: string[] };
}

type SearchState =
  | { status: 'loading'; items: ItemSummary[] }
  | { status: 'ready'; items: ItemSummary[]; total: number | null }
  | { status: 'unauthorized'; items: [] }
  | { status: 'offline'; items: [] };

function exactDisplay(value: string | null): string {
  if (value === null) return '—';
  const match = /^(-?)(\d+)(\.\d+)?$/.exec(value);
  if (!match) return value;
  return `${match[1]}${match[2]?.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${match[3] ?? ''}`;
}

export function ItemSearchPanel() {
  const [query, setQuery] = useState('');
  const [state, setState] = useState<SearchState>({ status: 'loading', items: [] });

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('query');
    if (requested !== null) setQuery(requested.slice(0, 120));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setState((current) => ({ status: 'loading', items: current.items }));
      try {
        const params = new URLSearchParams({ query, limit: '25' });
        const response = await fetch(`${apiOrigin}/v1/items?${params}`, {
          credentials: 'include',
          cache: 'no-store',
          signal: controller.signal,
        });
        if (response.status === 401) {
          setState({ status: 'unauthorized', items: [] });
          return;
        }
        if (!response.ok) throw new Error('search unavailable');
        const payload = (await response.json()) as { items: ItemSummary[]; total: number | null };
        setState({ status: 'ready', items: payload.items, total: payload.total });
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setState({ status: 'offline', items: [] });
      }
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  return (
    <div className="space-y-5">
      <Card className="border border-white/[0.03] bg-card/80">
        <CardContent className="p-4">
          <label htmlFor="catalog-search" className="relative block">
            <span className="sr-only">Search the item catalog</span>
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              id="catalog-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Try minecraft:diamond, a display name, or a variant fingerprint…"
              className="h-11 bg-background/55 pl-10"
            />
          </label>
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge variant="outline">All identities</Badge>
            <Badge variant="ghost">Exact variants</Badge>
            <Badge variant="ghost">Incomplete metadata</Badge>
            <Badge variant="ghost">Active asks</Badge>
            <Badge variant="ghost">Recorded sales</Badge>
          </div>
        </CardContent>
      </Card>

      <Card className="border border-white/[0.03] bg-card/80">
        <CardHeader>
          <CardTitle>Market catalog</CardTitle>
          <CardDescription>
            {state.status === 'ready'
              ? `${state.total ?? state.items.length} observed identities`
              : state.status === 'loading'
                ? 'Loading source-backed identities…'
                : 'Catalog unavailable'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {state.status === 'unauthorized' ? (
            <div className="grid min-h-64 place-items-center text-center">
              <div><p className="text-sm font-medium">Sign in to search private market data</p><Link href="/login" className={`${buttonVariants({ size: 'sm' })} mt-4`}>Sign in</Link></div>
            </div>
          ) : state.status === 'offline' ? (
            <div className="grid min-h-64 place-items-center text-center"><div><p className="text-sm font-medium">The hosted API is unavailable</p><p className="mt-1 text-xs text-muted-foreground">Search will resume when the service is reachable.</p></div></div>
          ) : state.items.length === 0 ? (
            <div className="grid min-h-64 place-items-center rounded-lg border border-dashed border-border px-6 text-center">
              <div className="max-w-md">
                <Boxes className="mx-auto size-5 text-muted-foreground" aria-hidden="true" />
                <h2 className="mt-4 text-sm font-medium">No source-backed items found</h2>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">Items appear only after validation. No demo prices or invented variants are inserted.</p>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-border/70 overflow-hidden rounded-lg border border-border/70">
              {state.items.map((item) => (
                <Link key={item.id} href={`/items/${encodeURIComponent(item.id)}`} className="grid gap-3 bg-background/20 p-4 transition-colors hover:bg-secondary/55 sm:grid-cols-[minmax(0,1fr)_140px_140px] sm:items-center">
                  <div className="min-w-0"><div className="flex items-center gap-2"><p className="truncate text-sm font-medium">{item.displayName}</p><Badge variant="outline" className="shrink-0 text-[10px]">{item.identityState}</Badge></div><p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{item.baseItemId}{item.variantLabel ? ` · ${item.variantLabel}` : ''}</p></div>
                  <div><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Lowest ask</p><p className="mt-1 font-mono text-sm">{exactDisplay(item.lowestAsk)}</p></div>
                  <div><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Sale median</p><p className="mt-1 font-mono text-sm">{exactDisplay(item.recentSaleMedian)}</p></div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
