import { Database, SlidersHorizontal } from 'lucide-react';

import { ItemSearchPanel } from '@/components/item-search-panel';
import { WorkspaceShell } from '@/components/workspace-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function ItemsPage() {
  return (
    <WorkspaceShell
      active="items"
      eyebrow="Catalog"
      title="Items and variants"
      description="Search broad item identities or narrow to economically meaningful variants. Incomplete metadata is kept visible instead of being promoted to an exact match."
      actions={
        <Button variant="outline" size="sm">
          <SlidersHorizontal aria-hidden="true" />
          Filters
        </Button>
      }
    >
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <ItemSearchPanel />
        <Card className="h-fit border border-white/[0.03] bg-card/80">
          <CardHeader>
            <CardTitle>Identity quality</CardTitle>
            <CardDescription>How variant matches will be labeled.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-xs">
            {[
              ['Exact', 'All required identity fields are present.'],
              ['Strong', 'Distinctive metadata agrees, with noncritical gaps.'],
              ['Broad', 'Grouped only by base item; never shown as exact.'],
              ['Ambiguous', 'Source data cannot separate likely variants.'],
            ].map(([label, text], index) => (
              <div key={label} className="flex gap-3">
                <span className={`mt-1 size-2 rounded-full ${index < 2 ? 'bg-emerald-300' : 'bg-amber-300'}`} />
                <div>
                  <p className="font-medium text-foreground">{label}</p>
                  <p className="mt-0.5 leading-5 text-muted-foreground">{text}</p>
                </div>
              </div>
            ))}
            <div className="flex gap-3 border-t border-border pt-4">
              <Database className="mt-0.5 size-4 shrink-0 text-sky-300" aria-hidden="true" />
              <p className="leading-5 text-muted-foreground">
                Raw source evidence remains retained even when a record is quarantined or excluded from analytics.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </WorkspaceShell>
  );
}
