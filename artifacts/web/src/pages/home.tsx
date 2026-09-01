import { useGetMarketOverview } from "@workspace/api-client-react";
import { StatCard } from "@/components/ui/stat-card";
import { formatCompact, formatMoney } from "@/lib/utils";
import { Activity, ArrowDownRight, ArrowUpRight, BarChart2, TrendingDown, TrendingUp } from "lucide-react";
import { Sparkline } from "@/components/charts/sparkline";
import { Link } from "wouter";
import { ItemIcon } from "@/components/ui/ItemIcon";

export default function Home() {
  const { data: overview, isLoading, error } = useGetMarketOverview();

  if (isLoading) return <div className="p-8 text-center text-muted-foreground">Loading market overview...</div>;
  if (error || !overview) return <div className="p-8 text-center text-destructive">Failed to load market overview</div>;

  return (
    <div className="container max-w-7xl mx-auto p-4 sm:p-6 lg:p-8 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Market Overview</h1>
        {overview.lastUpdated && (
          <div className="text-sm text-muted-foreground flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-success animate-pulse" />
            Live
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard 
          title="24h Volume" 
          value={formatMoney(overview.tradedValue24h)} 
          icon={<BarChart2 className="w-6 h-6" />}
        />
        <StatCard 
          title="24h Transactions" 
          value={formatCompact(overview.txCount24h)} 
          icon={<Activity className="w-6 h-6" />}
        />
        <StatCard 
          title="24h Items Sold" 
          value={formatCompact(overview.soldQty24h)} 
          icon={<ArrowUpRight className="w-6 h-6" />}
        />
        <StatCard 
          title="Active Listings" 
          value={formatCompact(overview.activeListings)} 
          icon={<ArrowDownRight className="w-6 h-6" />}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <TopList title="Top Gainers" items={overview.gainers} icon={<TrendingUp className="w-5 h-5 text-success" />} />
        <TopList title="Top Losers" items={overview.losers} icon={<TrendingDown className="w-5 h-5 text-destructive" />} />
        <TopList title="Most Traded" items={overview.mostTraded} icon={<BarChart2 className="w-5 h-5 text-primary" />} />
        <TopList title="Most Volatile" items={overview.mostVolatile} icon={<Activity className="w-5 h-5 text-warning" />} />
      </div>
    </div>
  );
}

function TopList({ title, items, icon }: { title: string, items: any[], icon: React.ReactNode }) {
  return (
    <div className="bg-card/50 border border-border/50 rounded-lg overflow-hidden backdrop-blur-sm">
      <div className="p-4 border-b border-border/50 flex items-center gap-2 bg-muted/20">
        {icon}
        <h2 className="font-semibold text-lg">{title}</h2>
      </div>
      <div className="divide-y divide-border/30">
        {items.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground text-sm">No data available</div>
        ) : (
          items.map((item, i) => (
            <Link key={item.scopeKey} href={`/items/${encodeURIComponent(item.scopeKey)}`}>
              <div className="p-4 flex items-center justify-between hover:bg-muted/50 transition-colors cursor-pointer group">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-mono text-muted-foreground w-4">{i + 1}</span>
                  <ItemIcon itemId={item.baseItemId} className="w-8 h-8 rounded" />
                  <div>
                    <div className="font-medium group-hover:text-primary transition-colors">{item.displayName}</div>
                    <div className="text-xs text-muted-foreground">{formatMoney(item.latestSale || item.bestAsk)}</div>
                  </div>
                </div>
                
                <div className="flex items-center gap-4">
                  {item.change24h !== undefined && item.change24h !== null && (
                    <div className={`text-sm font-mono ${item.change24h > 0 ? 'text-success' : item.change24h < 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
                      {item.change24h > 0 ? '+' : ''}{item.change24h.toFixed(1)}%
                    </div>
                  )}
                  {item.spark && (
                    <div className="w-20 h-8 opacity-50 group-hover:opacity-100 transition-opacity">
                      <Sparkline data={item.spark} />
                    </div>
                  )}
                </div>
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}