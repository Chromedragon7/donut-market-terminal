import type { ReactNode } from 'react';
import {
  Activity,
  Bell,
  BookOpen,
  Boxes,
  LayoutDashboard,
  LockKeyhole,
  Search,
  Settings2,
} from 'lucide-react';
import Link from '@/components/safe-link';

import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const navigation = [
  { id: 'overview', label: 'Overview', href: '/', icon: LayoutDashboard },
  { id: 'items', label: 'Items', href: '/items', icon: Boxes },
  { id: 'watchlist', label: 'Watchlist', href: '/watchlist', icon: BookOpen },
  { id: 'alerts', label: 'Alerts', href: '/alerts', icon: Bell },
  { id: 'collection', label: 'Collection', href: '/collection', icon: Activity },
] as const;

function BrandMark() {
  return (
    <span
      aria-hidden="true"
      className="grid size-9 place-items-center rounded-[10px] border border-emerald-300/30 bg-emerald-300/10"
    >
      <span className="size-3 rotate-45 border border-emerald-200 bg-emerald-300/40" />
    </span>
  );
}

export function WorkspaceShell({
  active,
  eyebrow,
  title,
  description,
  actions,
  children,
}: {
  active: (typeof navigation)[number]['id'] | 'settings';
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen text-foreground">
      <header className="sticky top-0 z-30 border-b border-border/80 bg-background/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1680px] items-center gap-4 px-4 sm:px-6">
          <Link href="/" className="flex min-w-fit items-center gap-3 lg:w-56" aria-label="Gilded overview">
            <BrandMark />
            <div>
              <p className="text-sm font-semibold tracking-[0.12em]">GILDED</p>
              <p className="text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
                Market intelligence
              </p>
            </div>
          </Link>

          <form action="/items" method="get" className="relative mx-auto hidden w-full max-w-2xl md:block">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id="workspace-search"
              name="query"
              aria-label="Search items and variants"
              type="search"
              placeholder="Search items or exact variants…"
              className="h-9 border-border/80 bg-card/75 pl-9 shadow-inner"
            />
          </form>

          <div className="ml-auto flex items-center gap-2 lg:w-56 lg:justify-end">
            <Badge
              variant="outline"
              className="hidden border-amber-300/25 bg-amber-300/[0.06] text-amber-200 sm:inline-flex"
            >
              <span className="size-1.5 rounded-full bg-amber-300" aria-hidden="true" />
              Setup required
            </Badge>
            <Link
              href="/settings"
              aria-label="Open settings"
              className={cn(
                buttonVariants({ variant: active === 'settings' ? 'secondary' : 'outline', size: 'icon' }),
                active === 'settings' && 'text-emerald-200',
              )}
            >
              <Settings2 aria-hidden="true" />
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1680px] lg:grid-cols-[224px_minmax(0,1fr)]">
        <aside className="hidden min-h-[calc(100vh-4rem)] border-r border-border/70 px-3 py-5 lg:flex lg:flex-col">
          <nav aria-label="Primary" className="space-y-1">
            {navigation.map(({ id, label, href, icon: Icon }) => (
              <Link
                key={id}
                href={href}
                aria-current={id === active ? 'page' : undefined}
                className={cn(
                  buttonVariants({ variant: id === active ? 'secondary' : 'ghost' }),
                  'h-9 w-full justify-start gap-3 px-3',
                  id === active &&
                    'border border-emerald-200/10 bg-emerald-300/[0.08] text-emerald-100',
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
              Owner-only by default. Seller visibility is enforced before data leaves the API.
            </p>
          </div>
        </aside>

        <main className="min-w-0 px-4 py-5 sm:px-6 sm:py-7 xl:px-8">
          <nav
            aria-label="Mobile sections"
            className="-mx-1 mb-5 flex gap-1 overflow-x-auto pb-1 lg:hidden"
          >
            {navigation.slice(0, 4).map(({ id, label, href, icon: Icon }) => (
              <Link
                key={id}
                href={href}
                className={buttonVariants({
                  variant: id === active ? 'secondary' : 'ghost',
                  size: 'sm',
                })}
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
                  {eyebrow}
                </span>
                <span className="h-px w-8 bg-emerald-300/30" />
              </div>
              <h1 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p>
            </div>
            {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
          </div>

          <div className="mt-6">{children}</div>

          <footer className="mt-8 flex flex-col justify-between gap-2 border-t border-border/60 py-5 text-[11px] leading-5 text-muted-foreground sm:flex-row">
            <p>Independent project · not officially affiliated with DonutSMP.</p>
            <p>Asks are not sales · recorded volume may not equal total volume.</p>
          </footer>
        </main>
      </div>
    </div>
  );
}
