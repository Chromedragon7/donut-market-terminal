import { CircleDollarSign, ShieldAlert, TimerReset, TrendingUp } from 'lucide-react';

import { AlertManager } from '@/components/alert-manager';
import { WorkspaceShell } from '@/components/workspace-shell';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const alertTypes = [
  { name: 'Ask below threshold', detail: 'Current observed ask crosses a fixed limit.', icon: CircleDollarSign },
  { name: 'Relative price movement', detail: 'Ask or sale price moves against a labeled rolling baseline.', icon: TrendingUp },
  { name: 'Source freshness', detail: 'Collector or source data becomes stale beyond your tolerance.', icon: TimerReset },
  { name: 'Low-confidence signal', detail: 'An unusual opportunity carries identity, sample, or gap risk.', icon: ShieldAlert },
];

export default function AlertsPage() {
  return (
    <WorkspaceShell
      active="alerts"
      eyebrow="Rule engine"
      title="Alerts"
      description="Create deduplicated, cooldown-aware notifications backed by explicit source age and confidence."
    >
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <AlertManager />

        <Card className="h-fit border border-white/[0.03] bg-card/80">
          <CardHeader>
            <CardTitle>Supported rule shapes</CardTitle>
            <CardDescription>Delivery begins in the private dashboard.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {alertTypes.map(({ name, detail, icon: Icon }) => (
              <div key={name} className="flex gap-3">
                <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-secondary">
                  <Icon className="size-4 text-emerald-300" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-xs font-medium">{name}</p>
                  <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{detail}</p>
                </div>
              </div>
            ))}
            <div className="flex items-center justify-between border-t border-border pt-4 text-xs">
              <span className="text-muted-foreground">Discord / email providers</span>
              <Badge variant="outline">Not enabled</Badge>
            </div>
          </CardContent>
        </Card>
      </div>
    </WorkspaceShell>
  );
}
