import { BellRing, ShieldCheck } from 'lucide-react';

import { WatchlistManager } from '@/components/watchlist-manager';
import { WorkspaceShell } from '@/components/workspace-shell';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function WatchlistPage() {
  return (
    <WorkspaceShell
      active="watchlist"
      eyebrow="Personal monitoring"
      title="Watchlist"
      description="Track exact variants or broad item identities without changing what their underlying measurements mean."
    >
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <WatchlistManager />

        <div className="space-y-5">
          <Card className="border border-white/[0.03] bg-card/80">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><BellRing className="size-4 text-amber-300" />Watch behavior</CardTitle>
              <CardDescription>Per-item monitoring can reserve collector capacity.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-xs">
              <div className="flex items-center justify-between"><span className="text-muted-foreground">Refresh preference</span><Badge variant="outline">Safe default</Badge></div>
              <div className="flex items-center justify-between"><span className="text-muted-foreground">Variant policy</span><span>Exact when possible</span></div>
              <div className="flex items-center justify-between"><span className="text-muted-foreground">Stale warning</span><span>Enabled</span></div>
              <div className="flex items-center justify-between"><span className="text-muted-foreground">In-game display</span><span>Deferred</span></div>
            </CardContent>
          </Card>

          <Card className="border border-emerald-300/15 bg-emerald-300/[0.035]">
            <CardContent className="flex gap-3 p-4 text-xs leading-5 text-muted-foreground">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-300" aria-hidden="true" />
              A watch changes collection priority only within the configured rate budget. Completed-transaction continuity always keeps reserved capacity.
            </CardContent>
          </Card>
        </div>
      </div>
    </WorkspaceShell>
  );
}
