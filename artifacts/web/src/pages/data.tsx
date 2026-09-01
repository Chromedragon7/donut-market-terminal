import { useState } from "react";
import { Link } from "wouter";
import { useGetDataSales } from "@workspace/api-client-react";
import type { GetDataSalesParams } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatMoneyExact, formatRelativeTime } from "@/lib/utils";
import {
  ChevronLeft,
  ChevronRight,
  Database,
  Download,
  GitBranch,
  Hash,
  Search,
  ShieldCheck,
  Timer,
} from "lucide-react";

const PAGE_SIZE = 50;

export default function DataPage() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [item, setItem] = useState("");
  const [seller, setSeller] = useState("");
  const [page, setPage] = useState(1);

  const params: GetDataSalesParams = {
    page,
    pageSize: PAGE_SIZE,
    ...(from ? { from: new Date(from).toISOString() } : {}),
    ...(to ? { to: new Date(to).toISOString() } : {}),
    ...(item.trim() ? { item: item.trim() } : {}),
    ...(seller.trim() ? { seller: seller.trim() } : {}),
  };

  const { data, isLoading } = useGetDataSales(params);
  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const resetFilters = () => {
    setFrom("");
    setTo("");
    setItem("");
    setSeller("");
    setPage(1);
  };

  const exportCsv = () => {
    if (rows.length === 0) return;
    const header = [
      "soldAt",
      "item",
      "seller",
      "quantity",
      "unitPrice",
      "totalPrice",
    ];
    const escape = (v: string) =>
      /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    const csv = [
      header.join(","),
      ...rows.map((r) =>
        [
          r.soldAt,
          escape(r.displayName),
          escape(r.sellerName ?? ""),
          String(r.quantity),
          String(r.unitPrice),
          String(r.totalPrice),
        ].join(","),
      ),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `donut-sales-page${page}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="container max-w-6xl mx-auto p-4 sm:p-6 lg:p-8 space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Data Explorer</h1>
        <p className="text-muted-foreground mt-2">
          Browse recorded sales with date, item, and seller filters. Export the
          current page as CSV.
        </p>
      </div>

      <Card className="bg-card/50 backdrop-blur border-border/50">
        <CardContent className="pt-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="from">From</Label>
              <Input
                id="from"
                type="date"
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value);
                  setPage(1);
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="to">To</Label>
              <Input
                id="to"
                type="date"
                value={to}
                onChange={(e) => {
                  setTo(e.target.value);
                  setPage(1);
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="item">Item</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
                <Input
                  id="item"
                  className="pl-8"
                  placeholder="Search item…"
                  value={item}
                  onChange={(e) => {
                    setItem(e.target.value);
                    setPage(1);
                  }}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="seller">Seller</Label>
              <Input
                id="seller"
                placeholder="Seller name…"
                value={seller}
                onChange={(e) => {
                  setSeller(e.target.value);
                  setPage(1);
                }}
              />
            </div>
          </div>
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="sm" onClick={resetFilters}>
              Clear filters
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={exportCsv}
              disabled={rows.length === 0}
            >
              <Download className="w-4 h-4 mr-1" /> CSV
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card/50 backdrop-blur border-border/50">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Seller</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Unit Price</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Sold</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-center text-muted-foreground py-10"
                  >
                    Loading…
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-center text-muted-foreground py-10"
                  >
                    No sales recorded yet — collectors may not have run, or no
                    rows match your filters.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Link
                        href={`/items/${encodeURIComponent(r.scopeKey)}`}
                        className="hover:text-primary hover:underline"
                      >
                        {r.displayName}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {r.sellerName ?? "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.quantity}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoneyExact(r.unitPrice)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoneyExact(r.totalPrice)}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {formatRelativeTime(r.soldAt)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          {total > 0
            ? `${total.toLocaleString()} sale${total === 1 ? "" : "s"}`
            : "No results"}
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            <ChevronLeft className="w-4 h-4" /> Prev
          </Button>
          <span className="text-sm tabular-nums">
            {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div>
        <h2 className="text-2xl font-bold tracking-tight">
          Data &amp; Methodology
        </h2>
        <p className="text-muted-foreground mt-2">
          How Donut Market Terminal collects, normalizes, and derives the numbers
          you see.
        </p>
      </div>

      <Card className="bg-card/50 backdrop-blur border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Database className="w-5 h-5 text-primary" /> Sources
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            All data is pulled server-side from the public DonutSMP API using a
            rate-limited, concurrency-capped client. Your browser never sees the
            API key.
          </p>
          <p>
            We collect completed transactions (sales), current auction listings,
            leaderboards, and watched-player stats. We never call moderation or
            Shield endpoints.
          </p>
        </CardContent>
      </Card>

      <Card className="bg-card/50 backdrop-blur border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Hash className="w-5 h-5 text-primary" /> Item Variants
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            Items are grouped by a canonical SHA-256{" "}
            <span className="font-mono">variant_hash</span> computed from the base
            item id plus normalized enchantments, trim, lore, and container
            contents. This lets an enchanted diamond sword be priced separately
            from a plain one.
          </p>
          <p>
            The <span className="font-mono">base</span> scope aggregates all
            variants of an item; the <span className="font-mono">variant</span>{" "}
            scope keeps them distinct.
          </p>
        </CardContent>
      </Card>

      <Card className="bg-card/50 backdrop-blur border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <GitBranch className="w-5 h-5 text-primary" /> Derived Metrics
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            Money is stored as exact decimal values (no floating-point drift).
            Medians, changes, and volatility are computed from unit prices (total
            price ÷ quantity) over rolling windows.
          </p>
          <p>
            A <span className="font-mono">confidence</span> score reflects how
            much sample data backs a price — thin markets are flagged as
            low-confidence.
          </p>
        </CardContent>
      </Card>

      <Card className="bg-card/50 backdrop-blur border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Timer className="w-5 h-5 text-primary" /> Freshness
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            Collectors run as idempotent jobs with advisory locks so they never
            overlap. Pages show the last sync time and flag stale data (older than
            ~30 minutes).
          </p>
        </CardContent>
      </Card>

      <Card className="bg-card/50 backdrop-blur border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <ShieldCheck className="w-5 h-5 text-primary" /> Limitations
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            DonutSMP exposes no public order book or bid queue. Sell-side
            estimates are modeled from sales velocity, not real demand. All prices
            are estimates derived from public data and may lag the live game.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
