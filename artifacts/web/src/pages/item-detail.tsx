import { useState } from "react";
import { Link, useRoute } from "wouter";
import ReactECharts from "echarts-for-react";
import {
  useGetItemDetail,
  useGetItemHistory,
  useGetItemListings,
  useGetItemTransactions,
} from "@workspace/api-client-react";
import type { GetItemHistoryRange } from "@workspace/api-client-react";
import { ItemIcon } from "@/components/ui/ItemIcon";
import { StatCard } from "@/components/ui/stat-card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  formatMoney,
  formatMoneyExact,
  formatPercent,
  formatRelativeTime,
  cn,
} from "@/lib/utils";

const RANGES: GetItemHistoryRange[] = ["24h", "7d", "30d", "90d", "all"];

function movingAverage(values: (number | null)[], window: number): (number | null)[] {
  return values.map((_, i) => {
    if (i < window - 1) return null;
    const slice = values.slice(i - window + 1, i + 1);
    const nums = slice.filter((v): v is number => v !== null);
    if (nums.length === 0) return null;
    return nums.reduce((a, b) => a + b, 0) / nums.length;
  });
}

const axisLine = { lineStyle: { color: "#475569" } };
const axisLabel = { color: "#94a3b8", fontSize: 10 };
const splitLine = { lineStyle: { color: "rgba(71,85,105,0.2)" } };

function HistoryCharts({ scopeKey, range }: { scopeKey: string; range: GetItemHistoryRange }) {
  const interval = range === "24h" ? "1h" : range === "7d" ? "1h" : "1d";
  const { data, isLoading } = useGetItemHistory({ scopeKey, interval, range });
  const candles = data?.candles ?? [];
  const depth = data?.depth ?? [];
  const histogram = data?.histogram ?? [];

  if (isLoading) {
    return <div className="h-80 flex items-center justify-center text-muted-foreground">Loading chart…</div>;
  }
  if (candles.length === 0) {
    return (
      <div className="h-80 flex items-center justify-center text-muted-foreground">
        No price history yet for this range.
      </div>
    );
  }

  const ohlc = candles.map((c) => [c.open ?? 0, c.close ?? 0, c.low ?? 0, c.high ?? 0]);
  const dates = candles.map((c) => new Date(c.t).toLocaleString());
  const closes = candles.map((c) => c.close ?? c.median ?? null);
  const maWindow = Math.min(7, Math.max(2, Math.floor(candles.length / 3)));
  const ma = movingAverage(closes, maWindow);

  const priceOption = {
    backgroundColor: "transparent",
    grid: { left: 60, right: 20, top: 30, bottom: 40 },
    legend: { textStyle: { color: "#94a3b8" }, top: 0 },
    tooltip: { trigger: "axis", axisPointer: { type: "cross" } },
    xAxis: { type: "category", data: dates, axisLine, axisLabel },
    yAxis: { scale: true, axisLine, axisLabel, splitLine },
    series: [
      {
        name: "Price",
        type: "candlestick",
        data: ohlc,
        itemStyle: {
          color: "#22c55e",
          color0: "#ef4444",
          borderColor: "#22c55e",
          borderColor0: "#ef4444",
        },
      },
      {
        name: `MA${maWindow}`,
        type: "line",
        data: ma,
        smooth: true,
        showSymbol: false,
        lineStyle: { color: "#eab308", width: 1.5 },
        connectNulls: true,
      },
    ],
  };

  return (
    <div className="space-y-4">
      <ReactECharts option={priceOption} style={{ height: 340 }} notMerge />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <h3 className="text-sm font-medium text-muted-foreground mb-1">Ask Depth</h3>
          {depth.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
              No live listings.
            </div>
          ) : (
            <ReactECharts
              option={{
                backgroundColor: "transparent",
                grid: { left: 50, right: 16, top: 16, bottom: 32 },
                tooltip: { trigger: "axis" },
                xAxis: {
                  type: "category",
                  data: depth.map((d) => Math.round(d.unitPrice).toLocaleString()),
                  name: "Unit price",
                  nameTextStyle: { color: "#94a3b8" },
                  axisLine,
                  axisLabel,
                },
                yAxis: { type: "value", name: "Cumulative qty", nameTextStyle: { color: "#94a3b8" }, axisLine, axisLabel, splitLine },
                series: [
                  {
                    type: "line",
                    step: "end",
                    data: depth.map((d) => d.cumulativeQty),
                    areaStyle: { color: "rgba(59,130,246,0.15)" },
                    lineStyle: { color: "#3b82f6" },
                    showSymbol: false,
                  },
                ],
              }}
              style={{ height: 200 }}
              notMerge
            />
          )}
        </div>
        <div>
          <h3 className="text-sm font-medium text-muted-foreground mb-1">Sale Price Distribution</h3>
          {histogram.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
              No sales in range.
            </div>
          ) : (
            <ReactECharts
              option={{
                backgroundColor: "transparent",
                grid: { left: 50, right: 16, top: 16, bottom: 32 },
                tooltip: { trigger: "axis" },
                xAxis: {
                  type: "category",
                  data: histogram.map((h) => Math.round((h.from + h.to) / 2).toLocaleString()),
                  axisLine,
                  axisLabel,
                },
                yAxis: { type: "value", axisLine, axisLabel, splitLine },
                series: [
                  {
                    type: "bar",
                    data: histogram.map((h) => h.count),
                    itemStyle: { color: "#8b5cf6" },
                  },
                ],
              }}
              style={{ height: 200 }}
              notMerge
            />
          )}
        </div>
      </div>
    </div>
  );
}

function Listings({ scopeKey }: { scopeKey: string }) {
  const { data, isLoading } = useGetItemListings(scopeKey);
  const rows = data ?? [];
  if (isLoading) return <div className="py-8 text-center text-muted-foreground">Loading…</div>;
  if (rows.length === 0)
    return <div className="py-8 text-center text-muted-foreground">No active listings.</div>;
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>Seller</TableHead>
          <TableHead className="text-right">Qty</TableHead>
          <TableHead className="text-right">Unit Price</TableHead>
          <TableHead className="text-right">Total</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.id}>
            <TableCell>
              {r.sellerName ? (
                <Link href={`/players/${encodeURIComponent(r.sellerName)}`}>
                  <span className="hover:text-primary cursor-pointer">{r.sellerName}</span>
                </Link>
              ) : (
                "—"
              )}
            </TableCell>
            <TableCell className="text-right font-mono">{r.quantity}</TableCell>
            <TableCell className="text-right font-mono text-primary">{formatMoneyExact(r.unitPrice)}</TableCell>
            <TableCell className="text-right font-mono">{formatMoneyExact(r.totalPrice)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function Transactions({ scopeKey }: { scopeKey: string }) {
  const { data, isLoading } = useGetItemTransactions({ scopeKey, page: 1, pageSize: 50 });
  const rows = data ?? [];
  if (isLoading) return <div className="py-8 text-center text-muted-foreground">Loading…</div>;
  if (rows.length === 0)
    return <div className="py-8 text-center text-muted-foreground">No recorded sales.</div>;
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>Sold</TableHead>
          <TableHead>Seller</TableHead>
          <TableHead className="text-right">Qty</TableHead>
          <TableHead className="text-right">Unit Price</TableHead>
          <TableHead className="text-right">Total</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.id}>
            <TableCell className="text-muted-foreground">{formatRelativeTime(r.soldAt)}</TableCell>
            <TableCell>{r.sellerName ?? "—"}</TableCell>
            <TableCell className="text-right font-mono">{r.quantity}</TableCell>
            <TableCell className="text-right font-mono">{formatMoneyExact(r.unitPrice)}</TableCell>
            <TableCell className="text-right font-mono">{formatMoneyExact(r.totalPrice)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export default function ItemDetail() {
  const [, params] = useRoute("/items/:scopeKey");
  const scopeKey = params?.scopeKey ? decodeURIComponent(params.scopeKey) : "";
  const [range, setRange] = useState<GetItemHistoryRange>("7d");

  const { data, isLoading, error } = useGetItemDetail(scopeKey);

  if (isLoading) return <div className="p-12 text-center text-muted-foreground">Loading item…</div>;
  if (error || !data) {
    return (
      <div className="container max-w-2xl mx-auto p-8 text-center space-y-3">
        <h1 className="text-2xl font-bold">Item not found</h1>
        <p className="text-muted-foreground">
          No data for <span className="font-mono">{scopeKey}</span>.
        </p>
      </div>
    );
  }

  const m = data.metrics;

  return (
    <div className="container max-w-7xl mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
      <div className="flex items-center gap-4">
        <ItemIcon itemId={data.baseItemId} className="w-12 h-12" />
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{data.displayName}</h1>
          <p className="text-sm text-muted-foreground font-mono">{data.baseItemId}</p>
        </div>
      </div>

      {data.signals.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {data.signals.map((s, i) => (
            <Badge
              key={i}
              variant="secondary"
              className={cn(
                s.tone === "positive" && "bg-success/15 text-success",
                s.tone === "negative" && "bg-destructive/15 text-destructive",
                s.tone === "warning" && "bg-warning/15 text-warning",
              )}
              title={s.detail}
            >
              {s.label}
            </Badge>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <StatCard title="Latest Sale" value={formatMoney(m.latestSale)} />
        <StatCard title="Best Ask" value={formatMoney(m.bestAsk)} />
        <StatCard title="Median 24h" value={formatMoney(m.median24h)} />
        <StatCard
          title="24h Change"
          value={<span className={cn(m.change24h && m.change24h > 0 ? "text-success" : m.change24h && m.change24h < 0 ? "text-destructive" : "")}>{formatPercent(m.change24h)}</span>}
        />
        <StatCard title="Active Listings" value={m.activeListings ?? "—"} />
        <StatCard title="Confidence" value={`${Math.round((m.confidence ?? 0) * 100)}%`} />
      </div>

      <div className="rounded-lg border border-border/50 bg-card/50 backdrop-blur-sm p-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold">Price History</h2>
          <div className="flex rounded-md border border-border overflow-hidden">
            {RANGES.map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={cn(
                  "px-3 py-1 text-xs transition-colors",
                  range === r ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted",
                )}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
        <HistoryCharts scopeKey={scopeKey} range={range} />
      </div>

      <Tabs defaultValue="listings">
        <TabsList>
          <TabsTrigger value="listings">Listings</TabsTrigger>
          <TabsTrigger value="transactions">Recent Sales</TabsTrigger>
          {data.variants && data.variants.length > 0 && (
            <TabsTrigger value="variants">Variants ({data.variants.length})</TabsTrigger>
          )}
        </TabsList>
        <TabsContent value="listings">
          <div className="rounded-lg border border-border/50 bg-card/50 backdrop-blur-sm overflow-x-auto">
            <Listings scopeKey={scopeKey} />
          </div>
        </TabsContent>
        <TabsContent value="transactions">
          <div className="rounded-lg border border-border/50 bg-card/50 backdrop-blur-sm overflow-x-auto">
            <Transactions scopeKey={scopeKey} />
          </div>
        </TabsContent>
        {data.variants && data.variants.length > 0 && (
          <TabsContent value="variants">
            <div className="rounded-lg border border-border/50 bg-card/50 backdrop-blur-sm divide-y divide-border/30">
              {data.variants.map((v) => (
                <Link key={v.scopeKey} href={`/items/${encodeURIComponent(v.scopeKey)}`}>
                  <div className="p-3 flex items-center justify-between hover:bg-muted/40 cursor-pointer">
                    <span className="font-medium">{v.displayName}</span>
                    <div className="flex gap-1">
                      {v.enchants?.slice(0, 4).map((e, i) => (
                        <Badge key={i} variant="secondary" className="text-[10px]">
                          {e.name} {e.level}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
