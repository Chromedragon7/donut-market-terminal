import Link from '@/components/safe-link';
import {
  Activity,
  Bell,
  BookOpen,
  Boxes,
  ChartNoAxesCombined,
  LayoutDashboard,
  ListFilter,
  LockKeyhole,
  Search,
  Settings2,
  Sparkles,
} from 'lucide-react';

import { LiveOverviewMetrics } from '@/components/live-overview-metrics';
import { CollectorStatusBanner, SourceFeaturePanel } from '@/components/source-status';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const navigation = [
  { label: 'Overview', icon: LayoutDashboard, href: '/', active: true },
  { label: 'Items', icon: Boxes, href: '/items' },
  { label: 'Watchlist', icon: BookOpen, href: '/watchlist' },
  { label: 'Alerts', icon: Bell, href: '/alerts' },
  { label: 'Collection', icon: Activity, href: '/collection' },
];

function BrandMark() {
  return (
    <span
      aria-hidden="true"
      className="grid size-9 place-items-center rounded-[10px] border border-emerald-300/30 bg-emerald-300/10 shadow-[inset_0_0_18px_rgb(110_231_183/8%)]"
    >
      <span className="size-3 rotate-45 border border-emerald-200 bg-emerald-300/40" />
    </span>
  );
}

function EmptyChart() {
  return (
    <div className="relative min-h-72 overflow-hidden rounded-lg border border-border/70 bg-black/10">
      <div className="market-grid absolute inset-0" aria-hidden="true" />
      <div className="absolute inset-x-5 top-1/2 border-t border-dashed border-emerald-200/20" />
      <div className="relative grid min-h-72 place-items-center px-6 text-center">
        <div className="max-w-md">
          <div className="mx-auto grid size-11 place-items-center rounded-xl border border-border bg-background/75">
            <ChartNoAxesCombined className="size-5 text-muted-foreground" aria-hidden="true" />
          </div>
          <h3 className="mt-4 text-sm font-medium">Choose an item to inspect retained history</h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Item views chart exact completed-sale medians and active asks separately, with gaps, source, sample context, and confidence.
          </p>
          <Link href="/items" className={`${buttonVariants({ size: 'sm' })} mt-4`}>Open item catalog</Link>
        </div>
      </div>
      <span className="absolute bottom-3 left-4 font-mono text-[10px] uppercase tracking-widest text-muted-foreground/70">
        Source · shown per observation
      </span>
      <span className="absolute bottom-3 right-4 font-mono text-[10px] uppercase tracking-widest text-muted-foreground/70">
        Confidence · shown per observation
      </span>
    </div>
  );
}

export default function Home() {
  return (
    <div className="min-h-screen text-foreground">
      <header className="sticky top-0 z-30 border-b border-border/80 bg-background/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1680px] items-center gap-4 px-4 sm:px-6">
          <div className="flex min-w-fit items-center gap-3 lg:w-56">
            <BrandMark />
            <div>
              <p className="text-sm font-semibold tracking-[0.12em]">GILDED</p>
              <p className="text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
                Market intelligence
              </p>
            </div>
          </div>

          <form action="/items" method="get" className="relative mx-auto hidden w-full max-w-2xl md:block">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id="overview-search"
              name="query"
              aria-label="Search items and variants"
              type="search"
              placeholder="Search items or exact variants…"
              className="h-9 border-border/80 bg-card/75 pl-9 shadow-inner placeholder:text-muted-foreground/80"
            />
          </form>

          <div className="ml-auto flex items-center gap-2 lg:w-56 lg:justify-end">
            <Badge
              variant="outline"
              className="hidden border-emerald-300/20 bg-emerald-300/[0.05] text-emerald-200 sm:inline-flex"
            >
              <LockKeyhole className="size-3" />
              Private
            </Badge>
            <Link
              href="/settings"
              aria-label="Open settings"
              className={buttonVariants({ variant: 'outline', size: 'icon' })}
            >
              <Settings2 aria-hidden="true" />
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1680px] lg:grid-cols-[224px_minmax(0,1fr)]">
        <aside className="hidden min-h-[calc(100vh-4rem)] border-r border-border/70 px-3 py-5 lg:flex lg:flex-col">
          <nav aria-label="Primary" className="space-y-1">
            {navigation.map(({ label, icon: Icon, href, active }) => (
              <Link
                key={label}
                href={href}
                className={cn(
                  buttonVariants({ variant: active ? 'secondary' : 'ghost' }),
                  'h-9 w-full justify-start gap-3 px-3',
                  active && 'border border-emerald-200/10 bg-emerald-300/[0.08] text-emerald-100',
                )}
              >
                <Icon aria-hidden="true" />
                {label}
              </Link>
            ))}
          </nav>

          <div className="mt-auto rounded-xl border border-border/70 bg-card/55 p-3">
            <div className="flex items-center gap-2 text-xs font-medium">
              <LockKeyhole className="size-3.5 text-emerald-300" aria-hidden="true" />
              Private workspace
            </div>
            <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
              Owner-only by default. Invite access and seller visibility stay under
              server-side policy.
            </p>
          </div>
        </aside>

        <main className="min-w-0 px-4 py-5 sm:px-6 sm:py-7 xl:px-8">
          <nav
            aria-label="Mobile sections"
            className="-mx-1 mb-5 flex gap-1 overflow-x-auto pb-1 lg:hidden"
          >
            {navigation.slice(0, 4).map(({ label, icon: Icon, href, active }) => (
              <Link
                key={label}
                href={href}
                className={buttonVariants({ variant: active ? 'secondary' : 'ghost', size: 'sm' })}
              >
                <Icon aria-hidden="true" />
                {label}
              </Link>
            ))}
          </nav>

          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
            <div>
              <div className="mb-2 flex items-center gap-2">
                <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-emerald-300">
                  Personal dashboard
                </span>
                <span className="h-px w-8 bg-emerald-300/30" />
              </div>
              <h1 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
                Market overview
              </h1>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                Active asking prices and recorded completed sales remain separate,
                traceable, and time-stamped.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Link href="/settings" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                <ListFilter aria-hidden="true" />
                Customize
              </Link>
              <Link href="/watchlist" className={buttonVariants({ size: 'sm' })}>
                <Sparkles aria-hidden="true" />
                Add watch
              </Link>
            </div>
          </div>

          <CollectorStatusBanner />

          <section aria-label="Headline market measurements" className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <LiveOverviewMetrics />
          </section>

          <div className="mt-5 grid gap-5 2xl:grid-cols-[minmax(0,1.7fr)_minmax(300px,0.7fr)]">
            <div className="space-y-5">
              <Card className="border border-white/[0.03] bg-card/80 shadow-[0_18px_56px_rgb(0_0_0/18%)]">
                <CardHeader>
                  <CardTitle>Item price and recorded volume</CardTitle>
                  <CardDescription>
                    Completed-sale median · lowest active ask · recorded quantity
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <EmptyChart />
                </CardContent>
              </Card>

              <Card className="border border-white/[0.03] bg-card/80">
                <CardHeader>
                  <CardTitle>Recent market evidence</CardTitle>
                  <CardDescription>
                    Every row will retain source, observation time, sample context, and confidence.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid min-h-28 place-items-center rounded-lg border border-dashed border-border px-5 text-center">
                    <div>
                      <p className="text-sm font-medium">Inspect source-backed evidence by item</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Search retained identities to view current asks, completed sales, exact prices, and history. Earlier history cannot be reconstructed.
                      </p>
                      <Link href="/items" className={`${buttonVariants({ variant: 'outline', size: 'sm' })} mt-4`}>Browse evidence</Link>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            <aside className="space-y-5">
              <SourceFeaturePanel />
            </aside>
          </div>

          <footer className="mt-8 flex flex-col justify-between gap-2 border-t border-border/60 py-5 text-[11px] leading-5 text-muted-foreground sm:flex-row">
            <p>Independent project · not officially affiliated with DonutSMP.</p>
            <p>Asks are not sales · recorded volume may not equal total volume.</p>
          </footer>
        </main>
      </div>
    </div>
  );
}
