'use client';

import { useCallback, useEffect, useState, type SyntheticEvent } from 'react';
import { BookOpen, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const apiOrigin = process.env.NEXT_PUBLIC_API_ORIGIN ?? '';

interface Watchlist {
  id: string;
  name: string;
  itemIds: string[];
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

export function WatchlistManager() {
  const [watchlists, setWatchlists] = useState<Watchlist[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'unauthorized' | 'offline'>('loading');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`${apiOrigin}/v1/watchlists`, { credentials: 'include', cache: 'no-store' });
      if (response.status === 401) return setStatus('unauthorized');
      if (!response.ok) throw new Error('unavailable');
      const payload = (await response.json()) as { watchlists: Watchlist[] };
      setWatchlists(payload.watchlists);
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
    const name = formString(form, 'name').trim();
    const itemIds = formString(form, 'itemIds').split(',').map((value) => value.trim()).filter(Boolean);
    try {
      const response = await fetch(`${apiOrigin}/v1/watchlists`, {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken() },
        body: JSON.stringify({ name, itemIds: [...new Set(itemIds)] }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(payload?.message ?? 'Could not create watchlist');
      }
      event.currentTarget.reset();
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create watchlist');
    }
  }

  async function remove(id: string) {
    setError(null);
    try {
      const response = await fetch(`${apiOrigin}/v1/watchlists/${encodeURIComponent(id)}`, {
        method: 'DELETE', credentials: 'include', headers: { 'x-csrf-token': csrfToken() },
      });
      if (!response.ok) throw new Error('Could not delete watchlist');
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not delete watchlist');
    }
  }

  if (status === 'unauthorized') return <Card className="border border-amber-300/20 bg-card/80"><CardContent className="grid min-h-72 place-items-center text-center"><div><p className="text-sm font-medium">Sign in to manage personal watchlists</p><Link href="/login" className={`${buttonVariants({ size: 'sm' })} mt-4`}>Sign in</Link></div></CardContent></Card>;
  if (status === 'offline') return <Card className="border border-white/[0.03] bg-card/80"><CardContent className="grid min-h-72 place-items-center text-center"><div><p className="text-sm font-medium">The hosted API is unavailable</p><p className="mt-1 text-xs text-muted-foreground">Your retained watchlists are not deleted.</p></div></CardContent></Card>;

  return (
    <div className="space-y-5">
      <Card className="border border-white/[0.03] bg-card/80">
        <CardHeader><CardTitle>Create a watchlist</CardTitle><CardDescription>Use validated item IDs, separated with commas. An empty list is allowed and can be filled later.</CardDescription></CardHeader>
        <CardContent>
          <form onSubmit={create} className="grid gap-4 md:grid-cols-[minmax(160px,0.6fr)_minmax(260px,1.4fr)_auto] md:items-end">
            <div className="space-y-2"><Label htmlFor="watchlist-name">Name</Label><Input id="watchlist-name" name="name" required maxLength={80} placeholder="Building materials" /></div>
            <div className="space-y-2"><Label htmlFor="watchlist-items">Item IDs</Label><Input id="watchlist-items" name="itemIds" placeholder="minecraft:diamond, minecraft:elytra" /></div>
            <Button type="submit"><Plus aria-hidden="true" />Create</Button>
          </form>
          {error ? <p role="alert" className="mt-3 text-xs text-red-200">{error}</p> : null}
        </CardContent>
      </Card>

      <Card className="border border-white/[0.03] bg-card/80">
        <CardHeader><CardTitle>Tracked lists</CardTitle><CardDescription>{status === 'loading' ? 'Loading…' : `${watchlists.length} personal watchlists`}</CardDescription></CardHeader>
        <CardContent>
          {watchlists.length === 0 ? (
            <div className="grid min-h-64 place-items-center rounded-lg border border-dashed border-border px-6 text-center"><div><BookOpen className="mx-auto size-5 text-muted-foreground" /><p className="mt-4 text-sm font-medium">Your watchlist is empty</p><p className="mt-1 text-xs text-muted-foreground">Create a named list above; no sample market records are inserted.</p></div></div>
          ) : (
            <div className="space-y-3">{watchlists.map((watchlist) => <div key={watchlist.id} className="flex flex-col justify-between gap-3 rounded-lg border border-border/70 bg-background/25 p-4 sm:flex-row sm:items-center"><div><p className="text-sm font-medium">{watchlist.name}</p><div className="mt-2 flex flex-wrap gap-1.5">{watchlist.itemIds.length ? watchlist.itemIds.map((id) => <Badge key={id} variant="outline" className="font-mono text-[10px]">{id}</Badge>) : <span className="text-xs text-muted-foreground">No items yet</span>}</div></div><Button variant="ghost" size="icon-sm" aria-label={`Delete ${watchlist.name}`} onClick={() => void remove(watchlist.id)}><Trash2 aria-hidden="true" /></Button></div>)}</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
