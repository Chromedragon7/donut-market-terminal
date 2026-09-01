import { useState } from "react";
import { Link } from "wouter";
import { useGetAuctions } from "@workspace/api-client-react";
import type { GetAuctionsParams } from "@workspace/api-client-react";
import { ItemIcon } from "@/components/ui/ItemIcon";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatMoneyExact, formatRelativeTime, cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight, Search, SlidersHorizontal } from "lucide-react";

const TIME_LEFT_OPTIONS: { label: string; value: string }[] = [
  { label: "Any time left", value: "" },
  { label: "< 10 minutes", value: String(10 * 60 * 1000) },
  { label: "< 1 hour", value: String(60 * 60 * 1000) },
  { label: "< 6 hours", value: String(6 * 60 * 60 * 1000) },
  { label: "< 24 hours", value: String(24 * 60 * 60 * 1000) },
];

function timeLeft(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms <= 0) return "expired";
  const min = Math.floor(ms / 60000);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  return `${hr}h ${min % 60}m`;
}

export default function Auctions() {
  const [search, setSearch] = useState("");
  const [seller, setSeller] = useState("");
  const [sortBy, setSortBy] = useState("unitPrice");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [showFilters, setShowFilters] = useState(false);
  const [enchant, setEnchant] = useState("");
  const [trim, setTrim] = useState("");
  const [lore, setLore] = useState("");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [minQuantity, setMinQuantity] = useState("");
  const [maxQuantity, setMaxQuantity] = useState("");
  const [maxTimeLeftMs, setMaxTimeLeftMs] = useState("");
  const pageSize = 50;

  const num = (v: string) => (v.trim() === "" ? undefined : Number(v));

  const params: GetAuctionsParams = {
    scope: "base",
    sortBy,
    sortDir,
    page,
    pageSize,
    search: search || undefined,
    seller: seller || undefined,
    enchant: enchant || undefined,
    trim: trim || undefined,
    lore: lore || undefined,
    minPrice: num(minPrice),
    maxPrice: num(maxPrice),
    minQuantity: num(minQuantity),
    maxQuantity: num(maxQuantity),
    maxTimeLeftMs: num(maxTimeLeftMs),
  };
  const { data, isLoading } = useGetAuctions(params);

  const activeFilterCount = [
    enchant,
    trim,
    lore,
    minPrice,
    maxPrice,
    minQuantity,
    maxQuantity,
    maxTimeLeftMs,
  ].filter((v) => v.trim() !== "").length;

  const clearFilters = () => {
    setEnchant("");
    setTrim("");
    setLore("");
    setMinPrice("");
    setMaxPrice("");
    setMinQuantity("");
    setMaxQuantity("");
    setMaxTimeLeftMs("");
    setPage(1);
  };

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="container max-w-7xl mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Live Auctions</h1>
          {data?.snapshotAt && (
            <p className="text-sm text-muted-foreground mt-1">
              Snapshot {formatRelativeTime(data.snapshotAt)}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search items…"
              className="pl-9 w-48"
            />
          </div>
          <Input
            value={seller}
            onChange={(e) => {
              setSeller(e.target.value);
              setPage(1);
            }}
            placeholder="Seller…"
            className="w-40"
          />
          <select
            value={`${sortBy}:${sortDir}`}
            onChange={(e) => {
              const [sb, sd] = e.target.value.split(":");
              setSortBy(sb);
              setSortDir(sd as "asc" | "desc");
              setPage(1);
            }}
            className="h-9 rounded-md border border-border bg-background px-2 text-sm"
          >
            <option value="unitPrice:asc">Unit price ↑</option>
            <option value="unitPrice:desc">Unit price ↓</option>
            <option value="totalPrice:asc">Total price ↑</option>
            <option value="totalPrice:desc">Total price ↓</option>
            <option value="timeLeftMs:asc">Ending soon</option>
          </select>
          <Button
            variant={showFilters ? "default" : "outline"}
            size="sm"
            onClick={() => setShowFilters((v) => !v)}
          >
            <SlidersHorizontal className="w-4 h-4 mr-1" />
            Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
          </Button>
        </div>
      </div>

      {showFilters && (
        <div className="rounded-lg border border-border/50 bg-card/50 backdrop-blur-sm p-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Enchantment</label>
              <Input
                value={enchant}
                onChange={(e) => { setEnchant(e.target.value); setPage(1); }}
                placeholder="e.g. sharpness"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Trim (material or pattern)</label>
              <Input
                value={trim}
                onChange={(e) => { setTrim(e.target.value); setPage(1); }}
                placeholder="e.g. netherite, sentry"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Lore contains</label>
              <Input
                value={lore}
                onChange={(e) => { setLore(e.target.value); setPage(1); }}
                placeholder="text in lore"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Unit price range</label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  inputMode="numeric"
                  value={minPrice}
                  onChange={(e) => { setMinPrice(e.target.value); setPage(1); }}
                  placeholder="min"
                />
                <span className="text-muted-foreground">–</span>
                <Input
                  type="number"
                  inputMode="numeric"
                  value={maxPrice}
                  onChange={(e) => { setMaxPrice(e.target.value); setPage(1); }}
                  placeholder="max"
                />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Quantity range</label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  inputMode="numeric"
                  value={minQuantity}
                  onChange={(e) => { setMinQuantity(e.target.value); setPage(1); }}
                  placeholder="min"
                />
                <span className="text-muted-foreground">–</span>
                <Input
                  type="number"
                  inputMode="numeric"
                  value={maxQuantity}
                  onChange={(e) => { setMaxQuantity(e.target.value); setPage(1); }}
                  placeholder="max"
                />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Time left</label>
              <select
                value={maxTimeLeftMs}
                onChange={(e) => { setMaxTimeLeftMs(e.target.value); setPage(1); }}
                className="h-9 rounded-md border border-border bg-background px-2 text-sm"
              >
                {TIME_LEFT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>
          {activeFilterCount > 0 && (
            <div className="flex justify-end">
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            </div>
          )}
        </div>
      )}

      <div className="rounded-lg border border-border/50 bg-card/50 backdrop-blur-sm overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Item</TableHead>
              <TableHead>Seller</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Unit Price</TableHead>
              <TableHead className="text-right">Total Price</TableHead>
              <TableHead className="text-right">Time Left</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                  No active listings. Data may not be collected yet — check the Admin page.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.id} className="group">
                  <TableCell>
                    <Link href={`/items/${encodeURIComponent(r.scopeKey)}`}>
                      <div className="flex items-center gap-3 cursor-pointer">
                        <ItemIcon itemId={r.baseItemId} className="w-7 h-7" />
                        <div>
                          <div className="font-medium group-hover:text-primary transition-colors">
                            {r.displayName}
                          </div>
                          {r.enchants && r.enchants.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {r.enchants.slice(0, 3).map((e, i) => (
                                <Badge key={i} variant="secondary" className="text-[10px] px-1 py-0">
                                  {e.name} {e.level}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {r.sellerName ? (
                      <Link href={`/players/${encodeURIComponent(r.sellerName)}`}>
                        <span className="hover:text-primary cursor-pointer">{r.sellerName}</span>
                      </Link>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono">{r.quantity}</TableCell>
                  <TableCell className="text-right font-mono text-primary">
                    {formatMoneyExact(r.unitPrice)}
                  </TableCell>
                  <TableCell className="text-right font-mono">{formatMoneyExact(r.totalPrice)}</TableCell>
                  <TableCell
                    className={cn(
                      "text-right font-mono",
                      r.timeLeftMs != null && r.timeLeftMs < 600000 && "text-warning",
                    )}
                  >
                    {timeLeft(r.timeLeftMs)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{total > 0 ? `${total} listings` : "No results"}</span>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            <ChevronLeft className="w-4 h-4" /> Prev
          </Button>
          <span className="font-mono">{page} / {totalPages}</span>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            Next <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
