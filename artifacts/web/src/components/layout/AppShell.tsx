import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Activity, BarChart2, Home, Info, LayoutDashboard, Settings, Swords, Trophy, Users } from "lucide-react";
import { useGetSetupStatus } from "@workspace/api-client-react";
import { SetupBanner } from "./SetupBanner";
import SetupPage from "@/pages/setup";
import { cn } from "@/lib/utils";

const SETUP_EXEMPT_PREFIXES = ["/admin", "/setup", "/data", "/about"];

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const [location] = useLocation();
  const { data: status } = useGetSetupStatus();

  const unconfigured =
    !!status && (!status.apiKeyConfigured || !status.databaseConfigured);
  const isExempt = SETUP_EXEMPT_PREFIXES.some((p) => location.startsWith(p));
  const showSetupGate = unconfigured && !isExempt;

  const navItems = [
    { href: "/", label: "Overview", icon: LayoutDashboard },
    { href: "/market", label: "Screener", icon: BarChart2 },
    { href: "/auctions", label: "Live Auctions", icon: Activity },
    { href: "/leaderboards", label: "Leaderboards", icon: Trophy },
  ];

  const secondaryNavItems = [
    { href: "/data", label: "Data", icon: Database },
    { href: "/about", label: "About", icon: Info },
    { href: "/admin", label: "Admin", icon: Settings },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground dark">
      <SetupBanner />
      
      <header className="sticky top-0 z-40 w-full border-b border-border bg-background/80 backdrop-blur-md">
        <div className="container max-w-7xl mx-auto flex h-14 items-center px-4">
          <div className="flex items-center gap-2 mr-8">
            <div className="w-8 h-8 rounded bg-primary/20 flex items-center justify-center border border-primary/50 shadow-[0_0_15px_rgba(59,130,246,0.3)]">
              <span className="font-mono font-bold text-primary">DM</span>
            </div>
            <span className="font-bold hidden sm:inline-block tracking-tight">Donut Market<span className="text-primary">.Terminal</span></span>
          </div>

          <nav className="flex items-center gap-1 text-sm font-medium flex-1 overflow-x-auto no-scrollbar">
            {navItems.map((item) => {
              const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
              const Icon = item.icon;
              return (
                <Link key={item.href} href={item.href}>
                  <div className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-md transition-colors whitespace-nowrap cursor-pointer",
                    isActive 
                      ? "bg-primary/10 text-primary" 
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}>
                    <Icon className="w-4 h-4" />
                    <span>{item.label}</span>
                  </div>
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center gap-2 ml-auto">
            {secondaryNavItems.map((item) => {
              const isActive = location.startsWith(item.href);
              const Icon = item.icon;
              return (
                <Link key={item.href} href={item.href}>
                  <div className={cn(
                    "p-2 rounded-md transition-colors cursor-pointer",
                    isActive 
                      ? "bg-primary/10 text-primary" 
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )} title={item.label}>
                    <Icon className="w-4 h-4" />
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col">
        {showSetupGate ? <SetupPage /> : children}
      </main>

      <footer className="border-t border-border bg-card py-6 mt-12">
        <div className="container max-w-7xl mx-auto px-4 text-center text-xs text-muted-foreground">
          <p className="mb-2 uppercase tracking-widest text-foreground/30 font-bold">Donut Market Terminal</p>
          <p className="max-w-2xl mx-auto">
            Donut Market Terminal is an unofficial, fan-made project and is not affiliated with, endorsed by, or sponsored by DonutSMP. 
            All prices are estimates derived from public auction data.
          </p>
        </div>
      </footer>
    </div>
  );
}

// Database icon not imported from lucide-react above, fixing inline
import { Database } from "lucide-react";