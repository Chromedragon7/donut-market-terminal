'use client';

import { useCallback, useEffect, useState, type SyntheticEvent } from 'react';
import { LayoutGrid, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';

const apiOrigin = process.env.NEXT_PUBLIC_API_ORIGIN ?? '';

type CardType = 'market_summary' | 'item_price' | 'price_chart' | 'volume' | 'supply' | 'source_health' | 'watchlist';

interface DashboardCard {
  id: string;
  type: CardType;
  itemId: string | null;
  metric: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Dashboard {
  id: string;
  name: string;
  cards: DashboardCard[];
  theme: 'system' | 'light' | 'dark';
  density: 'compact' | 'comfortable';
  updatedAt: string;
}

function csrfToken(): string {
  const prefix = 'donut_csrf=';
  const match = document.cookie.split('; ').find((cookie) => cookie.startsWith(prefix));
  return match ? decodeURIComponent(match.slice(prefix.length)) : '';
}

function formString(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === 'string' ? value : '';
}

export function DashboardManager() {
  const [dashboards, setDashboards] = useState<Dashboard[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'unauthorized' | 'offline'>('loading');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`${apiOrigin}/v1/dashboards`, { credentials: 'include', cache: 'no-store' });
      if (response.status === 401) return setStatus('unauthorized');
      if (!response.ok) throw new Error('unavailable');
      const payload = (await response.json()) as { dashboards: Dashboard[] };
      setDashboards(payload.dashboards);
      setStatus('ready');
    } catch {
      setStatus('offline');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function create(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    const itemId = formString(form, 'itemId').trim() || null;
    const focusType = formString(form, 'focusType') as CardType;
    const body = {
      name: formString(form, 'name').trim(),
      theme: formString(form, 'theme'),
      density: formString(form, 'density'),
      cards: [
        { id: 'market-summary', type: 'market_summary', itemId: null, metric: null, x: 0, y: 0, width: 7, height: 5 },
        { id: 'focus', type: focusType, itemId, metric: focusType === 'price_chart' ? 'completed_sale_median' : null, x: 0, y: 5, width: 7, height: 8 },
        { id: 'source-health', type: 'source_health', itemId: null, metric: null, x: 7, y: 0, width: 5, height: 6 },
      ],
    };
    try {
      const response = await fetch(`${apiOrigin}/v1/dashboards`, {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken() },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error('Could not save dashboard layout');
      event.currentTarget.reset();
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save dashboard layout');
    }
  }

  async function remove(id: string) {
    setError(null);
    try {
      const response = await fetch(`${apiOrigin}/v1/dashboards/${encodeURIComponent(id)}`, {
        method: 'DELETE', credentials: 'include', headers: { 'x-csrf-token': csrfToken() },
      });
      if (!response.ok) throw new Error('Could not delete dashboard');
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not delete dashboard');
    }
  }

  if (status === 'unauthorized') return <Card className="border border-amber-300/20 bg-card/80"><CardContent className="grid min-h-64 place-items-center text-center"><div><p className="text-sm font-medium">Sign in to manage dashboard layouts</p><Link href="/login" className={`${buttonVariants({ size: 'sm' })} mt-4`}>Sign in</Link></div></CardContent></Card>;
  if (status === 'offline') return <Card className="border border-white/[0.03] bg-card/80"><CardContent className="grid min-h-64 place-items-center text-center"><div><p className="text-sm font-medium">The hosted API is unavailable</p><p className="mt-1 text-xs text-muted-foreground">Saved layouts remain retained.</p></div></CardContent></Card>;

  return (
    <Card className="border border-white/[0.03] bg-card/80">
      <CardHeader><CardTitle className="flex items-center gap-2"><LayoutGrid className="size-4 text-emerald-300" />Dashboard layouts</CardTitle><CardDescription>Persist card choices, coordinates, density, and theme per authenticated user.</CardDescription></CardHeader>
      <CardContent className="space-y-6">
        <form onSubmit={create} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <div className="space-y-2"><Label htmlFor="dashboard-name">Layout name</Label><Input id="dashboard-name" name="name" required maxLength={100} placeholder="Trading desk" /></div>
          <div className="space-y-2"><Label htmlFor="dashboard-focus">Focus card</Label><NativeSelect id="dashboard-focus" name="focusType" defaultValue="price_chart" className="w-full"><NativeSelectOption value="price_chart">Completed-sale chart</NativeSelectOption><NativeSelectOption value="item_price">Item price evidence</NativeSelectOption><NativeSelectOption value="volume">Recorded volume</NativeSelectOption><NativeSelectOption value="supply">Observed supply</NativeSelectOption><NativeSelectOption value="watchlist">Watchlist</NativeSelectOption></NativeSelect></div>
          <div className="space-y-2"><Label htmlFor="dashboard-item">Focus item (optional)</Label><Input id="dashboard-item" name="itemId" pattern="[A-Za-z0-9:_.~-]+" placeholder="minecraft:diamond" /></div>
          <div className="space-y-2"><Label htmlFor="dashboard-theme">Theme</Label><NativeSelect id="dashboard-theme" name="theme" defaultValue="dark" className="w-full"><NativeSelectOption value="system">System</NativeSelectOption><NativeSelectOption value="light">Light</NativeSelectOption><NativeSelectOption value="dark">Dark</NativeSelectOption></NativeSelect></div>
          <div className="space-y-2"><Label htmlFor="dashboard-density">Density</Label><NativeSelect id="dashboard-density" name="density" defaultValue="comfortable" className="w-full"><NativeSelectOption value="comfortable">Comfortable</NativeSelectOption><NativeSelectOption value="compact">Compact</NativeSelectOption></NativeSelect></div>
          <div className="flex items-end"><Button type="submit"><Plus aria-hidden="true" />Save layout</Button></div>
        </form>
        {error ? <p role="alert" className="text-xs text-red-200">{error}</p> : null}
        <div className="border-t border-border/70 pt-5">
          <p className="mb-3 text-xs text-muted-foreground">{status === 'loading' ? 'Loading…' : `${dashboards.length} saved layouts`}</p>
          {dashboards.length === 0 ? <p className="rounded-lg border border-dashed border-border p-5 text-center text-xs text-muted-foreground">No saved layouts. The default overview remains available.</p> : <div className="space-y-3">{dashboards.map((dashboard) => <div key={dashboard.id} className="flex flex-col justify-between gap-3 rounded-lg border border-border/70 bg-background/25 p-4 sm:flex-row sm:items-center"><div><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-medium">{dashboard.name}</p><Badge variant="outline">{dashboard.theme}</Badge><Badge variant="outline">{dashboard.density}</Badge></div><p className="mt-2 text-xs text-muted-foreground">{dashboard.cards.length} cards · coordinates retained server-side</p></div><Button variant="ghost" size="icon-sm" aria-label={`Delete ${dashboard.name}`} onClick={() => void remove(dashboard.id)}><Trash2 aria-hidden="true" /></Button></div>)}</div>}
        </div>
      </CardContent>
    </Card>
  );
}
