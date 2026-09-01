import { useState } from "react";
import { useRoute } from "wouter";
import { useGetPlayer } from "@workspace/api-client-react";
import { StatCard } from "@/components/ui/stat-card";
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
import { formatRelativeTime } from "@/lib/utils";
import { RefreshCw, User } from "lucide-react";

export default function Player() {
  const [, params] = useRoute("/players/:username");
  const username = params?.username ? decodeURIComponent(params.username) : "";
  const [refresh, setRefresh] = useState(false);

  const { data, isLoading, isFetching, refetch } = useGetPlayer({
    user: username,
    refresh,
  });

  if (isLoading) {
    return <div className="p-12 text-center text-muted-foreground">Loading player…</div>;
  }

  if (!data || !data.found) {
    return (
      <div className="container max-w-2xl mx-auto p-8 text-center space-y-3">
        <User className="w-12 h-12 mx-auto text-muted-foreground/40" />
        <h1 className="text-2xl font-bold">Player not found</h1>
        <p className="text-muted-foreground">
          No data for <span className="font-mono">{username}</span>. They may not exist or have no
          recorded stats.
        </p>
      </div>
    );
  }

  return (
    <div className="container max-w-5xl mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          {data.uuid && (
            <img
              src={`https://crafatar.com/avatars/${data.uuid}?size=64&overlay`}
              alt={data.username}
              className="w-16 h-16 rounded-lg border border-border"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          )}
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{data.username}</h1>
            <div className="flex items-center gap-2 mt-1">
              {data.rank && <Badge variant="secondary">{data.rank}</Badge>}
              {data.location && <span className="text-sm text-muted-foreground">{data.location}</span>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span>Cached {formatRelativeTime(data.cachedAt)}</span>
          <Button
            variant="outline"
            size="sm"
            disabled={isFetching}
            onClick={() => {
              setRefresh(true);
              refetch().finally(() => setRefresh(false));
            }}
          >
            <RefreshCw className={isFetching ? "w-4 h-4 animate-spin" : "w-4 h-4"} /> Refresh
          </Button>
        </div>
      </div>

      {data.stats.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {data.stats.map((s) => (
            <StatCard key={s.key} title={s.label} value={s.rawValue} />
          ))}
        </div>
      )}

      {data.leaderboardAppearances && data.leaderboardAppearances.length > 0 && (
        <div className="rounded-lg border border-border/50 bg-card/50 backdrop-blur-sm overflow-hidden">
          <div className="p-4 border-b border-border/50 font-semibold">Leaderboard Appearances</div>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Rank</TableHead>
                <TableHead className="text-right">Value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.leaderboardAppearances.map((a, i) => (
                <TableRow key={i}>
                  <TableCell className="font-mono">#{a.rank}</TableCell>
                  <TableCell className="text-right font-mono">{a.rawValue}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
