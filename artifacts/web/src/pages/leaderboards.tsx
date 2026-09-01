import { useState } from "react";
import { Link } from "wouter";
import { useGetLeaderboard } from "@workspace/api-client-react";
import type { GetLeaderboardParams } from "@workspace/api-client-react";
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
import { formatRelativeTime, cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight, Minus, Search, Trophy, TrendingDown, TrendingUp } from "lucide-react";

function RankMovement({ change }: { change: number | null | undefined }) {
  if (change === null || change === undefined) {
    return <span className="text-muted-foreground/40">—</span>;
  }
  if (change === 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-muted-foreground">
        <Minus className="w-3 h-3" />
      </span>
    );
  }
  if (change > 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-success">
        <TrendingUp className="w-3 h-3" />
        {change}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5 text-destructive">
      <TrendingDown className="w-3 h-3" />
      {Math.abs(change)}
    </span>
  );
}

const CATEGORIES: { key: string; label: string }[] = [
  { key: "money", label: "Money" },
  { key: "shards", label: "Shards" },
  { key: "kills", label: "Kills" },
  { key: "deaths", label: "Deaths" },
  { key: "mobskilled", label: "Mobs Killed" },
  { key: "playtime", label: "Playtime" },
  { key: "sell", label: "Sell" },
  { key: "shop", label: "Shop" },
  { key: "brokenblocks", label: "Broken Blocks" },
  { key: "placedblocks", label: "Placed Blocks" },
];

export default function Leaderboards() {
  const [category, setCategory] = useState("money");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const params: GetLeaderboardParams = {
    category,
    page,
    pageSize,
    search: search || undefined,
  };
  const { data, isLoading } = useGetLeaderboard(params);

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="container max-w-7xl mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
      <div className="flex items-center gap-3">
        <Trophy className="w-7 h-7 text-warning" />
        <h1 className="text-3xl font-bold tracking-tight">Leaderboards</h1>
      </div>

      <div className="flex flex-wrap gap-2">
        {CATEGORIES.map((c) => (
          <button
            key={c.key}
            onClick={() => {
              setCategory(c.key);
              setPage(1);
            }}
            className={cn(
              "px-3 py-1.5 rounded-full text-sm transition-colors border",
              category === c.key
                ? "bg-primary/10 text-primary border-primary/40"
                : "text-muted-foreground border-border hover:bg-muted",
            )}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search players…"
            className="pl-9 w-56"
          />
        </div>
        {data?.capturedAt && (
          <span className="text-sm text-muted-foreground">
            Captured {formatRelativeTime(data.capturedAt)}
          </span>
        )}
      </div>

      <div className="rounded-lg border border-border/50 bg-card/50 backdrop-blur-sm overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-16">Rank</TableHead>
              <TableHead className="w-20">Change</TableHead>
              <TableHead>Player</TableHead>
              <TableHead className="text-right">Value</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center py-12 text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center py-12 text-muted-foreground">
                  No leaderboard data yet for this category — check the Admin page.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={`${r.rank}-${r.username}`}>
                  <TableCell className="font-mono text-muted-foreground">#{r.rank}</TableCell>
                  <TableCell className="font-mono text-xs">
                    <RankMovement change={r.rankChange} />
                  </TableCell>
                  <TableCell>
                    <Link href={`/players/${encodeURIComponent(r.username)}`}>
                      <span className="font-medium hover:text-primary cursor-pointer">{r.username}</span>
                    </Link>
                  </TableCell>
                  <TableCell className="text-right font-mono">{r.rawValue}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{total > 0 ? `${total} players` : "No results"}</span>
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
