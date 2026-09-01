import { useEffect, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { useGetMarketScreener } from "@workspace/api-client-react";
import type { GetMarketScreenerParams } from "@workspace/api-client-react";
import { ItemIcon } from "@/components/ui/ItemIcon";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatMoney, formatCompact, formatPercent, cn } from "@/lib/utils";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Download, Search } from "lucide-react";

const COLUMNS: { key: string; label: string; numeric?: boolean }[] = [
  { key: "latestSale", label: "Latest", numeric: true },
  { key: "median24h", label: "Median 24h", numeric: true },
  { key: "change24h", label: "24h %", numeric: true },
  { key: "change7d", label: "7d %", numeric: true },
  { key: "volume24h", label: "Volume 24h", numeric: true },
  { key: "activeListings", label: "Listings", numeric: true },
  { key: "volatility", label: "Volatility", numeric: true },
  { key: "confidence", label: "Confidence", numeric: true },
];

function Change({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined)
    return <span className="text-muted-foreground">—</span>;
  return (
    <span
      className={cn(
        "font-mono",
        value > 0 ? "text-success" : value < 0 ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {formatPercent(value)}
    </span>
  );
}

export default function Market() {
  const searchString = useSearch();
  const [, navigate] = useLocation();
  const initial = new URLSearchParams(searchString);

  const [search, setSearch] = useState(initial.get("search") ?? "");
  const [scope, setScope] = useState<"base" | "variant">(
    initial.get("scope") === "variant" ? "variant" : "base",
  );
  const [sortBy, setSortBy] = useState(initial.get("sortBy") ?? "volume24h");
  const [sortDir, setSortDir] = useState<"asc" | "desc">(
    initial.get("sortDir") === "asc" ? "asc" : "desc",
  );
  const [minVolume, setMinVolume] = useState(initial.get("minVolume") ?? "");
  const [minSamples, setMinSamples] = useState(initial.get("minSamples") ?? "");
  const [page, setPage] = useState(Number(initial.get("page")) || 1);
  const pageSize = 50;

  const minVolumeNum = minVolume ? Number(minVolume) : undefined;
  const minSamplesNum = minSamples ? Number(minSamples) : undefined;

  const params: GetMarketScreenerParams = {
    scope,
    sortBy,
    sortDir,
    page,
    pageSize,
    search: search || undefined,
    minVolume: Number.isFinite(minVolumeNum) ? minVolumeNum : undefined,
    minSamples: Number.isFinite(minSamplesNum) ? minSamplesNum : undefined,
  };
  const { data, isLoading } = useGetMarketScreener(params);

  useEffect(() => {
    const q = new URLSearchParams();
    if (search) q.set("search", search);
    if (scope !== "base") q.set("scope", scope);
    if (sortBy !== "volume24h") q.set("sortBy", sortBy);
    if (sortDir !== "desc") q.set("sortDir", sortDir);
    if (minVolume) q.set("minVolume", minVolume);
    if (minSamples) q.set("minSamples", minSamples);
    if (page > 1) q.set("page", String(page));
    const qs = q.toString();
    navigate(qs ? `/market?${qs}` : "/market", { replace: true });
  }, [search, scope, sortBy, sortDir, minVolume, minSamples, page, navigate]);

  const exportCsv = () => {
    const rowsToExport = data?.rows ?? [];
    if (rowsToExport.length === 0) return;
    const header = [
      "scopeKey",
      "displayName",
      "latestSale",
      "median24h",
      "change24h",
      "change7d",
      "volume24h",
      "activeListings",
      "volatility",
      "confidence",
    ];
    const csv = [
      header.join(","),
      ...rowsToExport.map((r) =>
        [
          r.scopeKey,
          `"${(r.displayName ?? "").replace(/"/g, '""')}"`,
          r.latestSale ?? "",
          r.median24h ?? "",
          r.change24h ?? "",
          r.change7d ?? "",
          r.volume24h ?? "",
          r.activeListings ?? "",
          r.volatility ?? "",
          r.confidence ?? "",
        ].join(","),
      ),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `donut-screener-${scope}-page${page}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggleSort = (key: string) => {
    if (sortBy === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(key);
      setSortDir("desc");
    }
    setPage(1);
  };

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="container max-w-7xl mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h1 className="text-3xl font-bold tracking-tight">Market Screener</h1>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search items…"
              className="pl-9 w-56"
            />
          </div>
          <div className="flex rounded-md border border-border overflow-hidden">
            {(["base", "variant"] as const).map((s) => (
              <button
                key={s}
                onClick={() => {
                  setScope(s);
                  setPage(1);
                }}
                className={cn(
                  "px-3 py-2 text-sm capitalize transition-colors",
                  scope === s
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                {s}
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={rows.length === 0}>
            <Download className="w-4 h-4 mr-1" /> CSV
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Min volume (24h)</label>
          <Input
            type="number"
            inputMode="numeric"
            value={minVolume}
            onChange={(e) => {
              setMinVolume(e.target.value);
              setPage(1);
            }}
            placeholder="0"
            className="w-36"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Min samples</label>
          <Input
            type="number"
            inputMode="numeric"
            value={minSamples}
            onChange={(e) => {
              setMinSamples(e.target.value);
              setPage(1);
            }}
            placeholder="0"
            className="w-36"
          />
        </div>
        {(minVolume || minSamples) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setMinVolume("");
              setMinSamples("");
              setPage(1);
            }}
          >
            Clear filters
          </Button>
        )}
      </div>

      <div className="rounded-lg border border-border/50 bg-card/50 backdrop-blur-sm overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Item</TableHead>
              {COLUMNS.map((c) => (
                <TableHead
                  key={c.key}
                  className="text-right cursor-pointer select-none whitespace-nowrap"
                  onClick={() => toggleSort(c.key)}
                >
                  <span className="inline-flex items-center gap-1">
                    {c.label}
                    {sortBy === c.key &&
                      (sortDir === "asc" ? (
                        <ArrowUp className="w-3 h-3" />
                      ) : (
                        <ArrowDown className="w-3 h-3" />
                      ))}
                  </span>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-12 text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-12 text-muted-foreground">
                  No items match your filters. Data may not be collected yet — check the Admin page.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.scopeKey} className="group">
                  <TableCell>
                    <Link href={`/items/${encodeURIComponent(r.scopeKey)}`}>
                      <div className="flex items-center gap-3 cursor-pointer">
                        <ItemIcon itemId={r.baseItemId} className="w-7 h-7" />
                        <span className="font-medium group-hover:text-primary transition-colors">
                          {r.displayName}
                        </span>
                      </div>
                    </Link>
                  </TableCell>
                  <TableCell className="text-right font-mono">{formatMoney(r.latestSale)}</TableCell>
                  <TableCell className="text-right font-mono">{formatMoney(r.median24h)}</TableCell>
                  <TableCell className="text-right"><Change value={r.change24h} /></TableCell>
                  <TableCell className="text-right"><Change value={r.change7d} /></TableCell>
                  <TableCell className="text-right font-mono">{formatMoney(r.volume24h)}</TableCell>
                  <TableCell className="text-right font-mono">{formatCompact(r.activeListings)}</TableCell>
                  <TableCell className="text-right font-mono">
                    {r.volatility != null ? `${(r.volatility * 100).toFixed(1)}%` : "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {r.confidence != null ? `${Math.round(r.confidence * 100)}%` : "—"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {total > 0
            ? `Showing ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}`
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
          <span className="font-mono">
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
    </div>
  );
}
