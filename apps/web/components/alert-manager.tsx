'use client';

import { useCallback, useEffect, useState, type SyntheticEvent } from 'react';
import { Bell, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Switch } from '@/components/ui/switch';

const apiOrigin = process.env.NEXT_PUBLIC_API_ORIGIN ?? '';

const alertTypes = [
  ['ask_below', 'Ask below threshold'],
  ['ask_below_median_percent', 'Ask below median (%)'],
  ['sale_threshold', 'Completed sale threshold'],
  ['price_movement', 'Price movement (%)'],
  ['volume_spike', 'Volume spike (%)'],
  ['supply_change', 'Supply change (%)'],
  ['new_variant', 'New variant observed'],
  ['source_stale', 'Source becomes stale'],
  ['collector_failure', 'Collector failure'],
  ['historical_gap', 'Historical gap'],
  ['low_confidence', 'Low-confidence signal'],
] as const;

type AlertType = (typeof alertTypes)[number][0];

interface AlertRule {
  id: string;
  name: string;
  type: AlertType;
  itemId: string | null;
  threshold: string | null;
  percentage: number | null;
  cooldownSeconds: number;
  enabled: boolean;
  updatedAt: string;
}

const itemTypes = new Set<AlertType>([
  'ask_below', 'ask_below_median_percent', 'sale_threshold', 'price_movement',
  'volume_spike', 'supply_change', 'new_variant', 'low_confidence',
]);
const thresholdTypes = new Set<AlertType>(['ask_below', 'sale_threshold']);
const percentageTypes = new Set<AlertType>(['ask_below_median_percent', 'price_movement', 'volume_spike', 'supply_change']);

function csrfToken(): string {
  const prefix = 'donut_csrf=';
  const match = document.cookie.split('; ').find((cookie) => cookie.startsWith(prefix));
  return match ? decodeURIComponent(match.slice(prefix.length)) : '';
}

function errorMessage(payload: unknown, fallback: string): string {
  if (typeof payload !== 'object' || payload === null || !('error' in payload)) return fallback;
  const error = (payload as { error?: { message?: unknown } }).error;
  return typeof error?.message === 'string' ? error.message : fallback;
}

function formString(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === 'string' ? value : '';
}

export function AlertManager() {
  const [alerts, setAlerts] = useState<AlertRule[]>([]);
  const [type, setType] = useState<AlertType>('ask_below');
  const [status, setStatus] = useState<'loading' | 'ready' | 'unauthorized' | 'offline'>('loading');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`${apiOrigin}/v1/alerts`, { credentials: 'include', cache: 'no-store' });
      if (response.status === 401) return setStatus('unauthorized');
      if (!response.ok) throw new Error('unavailable');
      const payload = (await response.json()) as { alerts: AlertRule[] };
      setAlerts(payload.alerts);
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
    const selectedType = formString(form, 'type') as AlertType;
    const body = {
      name: formString(form, 'name').trim(),
      type: selectedType,
      itemId: itemTypes.has(selectedType) ? formString(form, 'itemId').trim() : null,
      threshold: thresholdTypes.has(selectedType) ? formString(form, 'threshold').trim() : null,
      percentage: percentageTypes.has(selectedType) ? Number(form.get('percentage')) : null,
      cooldownSeconds: Number(form.get('cooldownSeconds')),
      enabled: true,
    };
    try {
      const response = await fetch(`${apiOrigin}/v1/alerts`, {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken() },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(errorMessage(await response.json().catch(() => null), 'Could not create alert'));
      event.currentTarget.reset();
      setType('ask_below');
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create alert');
    }
  }

  async function replace(rule: AlertRule, enabled: boolean) {
    setError(null);
    try {
      const response = await fetch(`${apiOrigin}/v1/alerts/${encodeURIComponent(rule.id)}`, {
        method: 'PUT', credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken() },
        body: JSON.stringify({
          name: rule.name, type: rule.type, itemId: rule.itemId, threshold: rule.threshold,
          percentage: rule.percentage, cooldownSeconds: rule.cooldownSeconds, enabled,
        }),
      });
      if (!response.ok) throw new Error('Could not update alert');
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not update alert');
    }
  }

  async function remove(id: string) {
    setError(null);
    try {
      const response = await fetch(`${apiOrigin}/v1/alerts/${encodeURIComponent(id)}`, {
        method: 'DELETE', credentials: 'include', headers: { 'x-csrf-token': csrfToken() },
      });
      if (!response.ok) throw new Error('Could not delete alert');
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not delete alert');
    }
  }

  if (status === 'unauthorized') return <Card className="border border-amber-300/20 bg-card/80"><CardContent className="grid min-h-72 place-items-center text-center"><div><p className="text-sm font-medium">Sign in to manage alert rules</p><Link href="/login" className={`${buttonVariants({ size: 'sm' })} mt-4`}>Sign in</Link></div></CardContent></Card>;
  if (status === 'offline') return <Card className="border border-white/[0.03] bg-card/80"><CardContent className="grid min-h-72 place-items-center text-center"><div><p className="text-sm font-medium">The hosted API is unavailable</p><p className="mt-1 text-xs text-muted-foreground">Existing rules remain retained in PostgreSQL.</p></div></CardContent></Card>;

  return (
    <div className="space-y-5">
      <Card className="border border-white/[0.03] bg-card/80">
        <CardHeader><CardTitle>Create an alert</CardTitle><CardDescription>Rules preserve the metric they measure and apply a cooldown before repeated delivery.</CardDescription></CardHeader>
        <CardContent>
          <form onSubmit={create} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <div className="space-y-2"><Label htmlFor="alert-name">Name</Label><Input id="alert-name" name="name" required maxLength={100} placeholder="Diamond buy signal" /></div>
            <div className="space-y-2"><Label htmlFor="alert-type">Rule</Label><NativeSelect id="alert-type" name="type" value={type} onChange={(event) => setType(event.target.value as AlertType)} className="w-full">{alertTypes.map(([value, label]) => <NativeSelectOption key={value} value={value}>{label}</NativeSelectOption>)}</NativeSelect></div>
            {itemTypes.has(type) ? <div className="space-y-2"><Label htmlFor="alert-item">Item ID</Label><Input id="alert-item" name="itemId" required pattern="[A-Za-z0-9:_.~-]+" placeholder="minecraft:diamond" /></div> : null}
            {thresholdTypes.has(type) ? <div className="space-y-2"><Label htmlFor="alert-threshold">Price threshold</Label><Input id="alert-threshold" name="threshold" required inputMode="decimal" pattern="[0-9]+(?:\.[0-9]+)?" placeholder="125000" /></div> : null}
            {percentageTypes.has(type) ? <div className="space-y-2"><Label htmlFor="alert-percentage">Percentage</Label><Input id="alert-percentage" name="percentage" required type="number" min="0" max="10000" step="0.01" placeholder="15" /></div> : null}
            <div className="space-y-2"><Label htmlFor="alert-cooldown">Cooldown (seconds)</Label><Input id="alert-cooldown" name="cooldownSeconds" required type="number" min="30" max="2592000" defaultValue="300" /></div>
            <div className="flex items-end"><Button type="submit"><Plus aria-hidden="true" />Create rule</Button></div>
          </form>
          {error ? <p role="alert" className="mt-3 text-xs text-red-200">{error}</p> : null}
        </CardContent>
      </Card>

      <Card className="border border-white/[0.03] bg-card/80">
        <CardHeader><CardTitle>Configured rules</CardTitle><CardDescription>{status === 'loading' ? 'Loading…' : `${alerts.length} cooldown-aware rules`}</CardDescription></CardHeader>
        <CardContent>
          {alerts.length === 0 ? (
            <div className="grid min-h-56 place-items-center rounded-lg border border-dashed border-border px-6 text-center"><div><Bell className="mx-auto size-5 text-muted-foreground" /><p className="mt-4 text-sm font-medium">No alert rules yet</p><p className="mt-1 text-xs text-muted-foreground">Create a rule above; the app never inserts sample signals.</p></div></div>
          ) : (
            <div className="space-y-3">{alerts.map((rule) => <div key={rule.id} className="flex flex-col justify-between gap-3 rounded-lg border border-border/70 bg-background/25 p-4 sm:flex-row sm:items-center"><div><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-medium">{rule.name}</p><Badge variant="outline">{alertTypes.find(([value]) => value === rule.type)?.[1] ?? rule.type}</Badge></div><p className="mt-2 font-mono text-[11px] text-muted-foreground">{rule.itemId ?? 'workspace-wide'}{rule.threshold ? ` · ${rule.threshold} coins` : ''}{rule.percentage !== null ? ` · ${rule.percentage}%` : ''} · {rule.cooldownSeconds}s cooldown</p></div><div className="flex items-center gap-2"><Switch checked={rule.enabled} aria-label={`${rule.enabled ? 'Disable' : 'Enable'} ${rule.name}`} onCheckedChange={(checked) => void replace(rule, checked)} /><Button variant="ghost" size="icon-sm" aria-label={`Delete ${rule.name}`} onClick={() => void remove(rule.id)}><Trash2 aria-hidden="true" /></Button></div></div>)}</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
