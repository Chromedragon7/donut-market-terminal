import { RefreshCw, ShieldCheck, TriangleAlert } from 'lucide-react';

import { CollectionHealthLive } from '@/components/collection-health-live';
import { WorkspaceShell } from '@/components/workspace-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';

const priorities = [
  ['1', 'Completed-transaction continuity', 'Reserved capacity'],
  ['2', 'Watched-item active listings', 'Enabled after setup'],
  ['3', 'Broad market discovery', 'Enabled after setup'],
  ['4', 'Metadata refresh', 'Deferred by budget'],
  ['5', 'Low-priority backfills', 'Only when safe'],
];

export default function CollectionPage() {
  return (
    <WorkspaceShell
      active="collection"
      eyebrow="Operations"
      title="Collection health"
      description="Request timing, source latency, validation, gaps, and processing delay are tracked separately so a single green status cannot hide stale data."
      actions={
        <Button variant="outline" size="sm" disabled>
          <RefreshCw aria-hidden="true" />
          Run validation
        </Button>
      }
    >
      <CollectionHealthLive />

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(340px,0.75fr)]">
        <div className="space-y-5">
          <Card className="border border-white/[0.03] bg-card/80">
            <CardHeader>
              <CardTitle>Historical continuity</CardTitle>
              <CardDescription>Gaps remain permanent visible evidence; they are never interpolated away.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="market-grid relative min-h-64 overflow-hidden rounded-lg border border-border bg-black/10">
                <div className="absolute inset-x-5 top-1/2 flex items-center gap-2">
                  <span className="h-px flex-1 border-t border-dashed border-slate-500/50" />
                  <Badge variant="outline" className="bg-background/80 text-muted-foreground">Collection not started</Badge>
                  <span className="h-px flex-1 border-t border-dashed border-slate-500/50" />
                </div>
                <p className="absolute bottom-4 inset-x-4 text-center text-xs text-muted-foreground">
                  The API cannot recover transactions that left its rolling window before this collector observed them.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="border border-white/[0.03] bg-card/80">
            <CardHeader>
              <CardTitle>48–72 hour API validation study</CardTitle>
              <CardDescription>Defaults remain provisional until the configured mirror is measured.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between text-xs"><span>Study progress</span><span className="font-mono text-muted-foreground">0 / 72 hours</span></div>
              <Progress value={0} />
              <div className="grid gap-3 text-xs sm:grid-cols-2">
                {['Latency and response size', 'Throttling and auth failures', 'Transaction-window turnover', 'Page overlap and reordering', 'Listing and sale appearance delay', 'Metadata field completeness'].map((label) => (
                  <div key={label} className="flex items-center gap-2 rounded-lg border border-border/70 bg-background/30 p-3 text-muted-foreground">
                    <span className="size-1.5 rounded-full bg-slate-500" />{label}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-5">
          <Card className="border border-white/[0.03] bg-card/80">
            <CardHeader>
              <CardTitle>Rate-budget priorities</CardTitle>
              <CardDescription>A single key-wide scheduler prevents competing workers from overspending the source limit.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {priorities.map(([rank, label, status]) => (
                <div key={rank} className="grid grid-cols-[24px_1fr] gap-3 border-b border-border/60 pb-3 last:border-0 last:pb-0">
                  <span className="grid size-6 place-items-center rounded-md bg-secondary font-mono text-[10px] text-emerald-200">{rank}</span>
                  <div><p className="text-xs font-medium">{label}</p><p className="mt-0.5 text-[11px] text-muted-foreground">{status}</p></div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border border-amber-300/15 bg-amber-300/[0.035]">
            <CardContent className="space-y-3 p-4 text-xs leading-5 text-muted-foreground">
              <p className="flex gap-2"><TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-300" />A successful request does not prove the source window is complete.</p>
              <p className="flex gap-2"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-300" />Authorization headers and secret values are redacted before structured logging.</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </WorkspaceShell>
  );
}
