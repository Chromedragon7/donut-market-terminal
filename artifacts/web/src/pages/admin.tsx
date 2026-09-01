import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetAdminStatus,
  useAdminLogin,
  useAdminLogout,
  useTriggerSync,
  useGetWatchedPlayers,
  useAddWatchedPlayer,
  useRemoveWatchedPlayer,
  usePreviewImport,
  useCommitImport,
} from "@workspace/api-client-react";
import type {
  SyncTriggerInputJob,
  ImportRow,
  ImportReport,
} from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatRelativeTime, cn } from "@/lib/utils";
import { Lock, LogOut, RefreshCw, Trash2 } from "lucide-react";

const SYNC_JOBS: SyncTriggerInputJob[] = [
  "transactions",
  "listings",
  "leaderboards",
  "rollups",
  "cleanup",
  "all",
];

export default function Admin() {
  const queryClient = useQueryClient();
  const { data: status, isLoading, error, refetch } = useGetAdminStatus();

  const [password, setPassword] = useState("");
  const login = useAdminLogin();
  const logout = useAdminLogout();

  const authed = !error && !!status;

  if (isLoading) {
    return <div className="p-12 text-center text-muted-foreground">Loading…</div>;
  }

  if (!authed) {
    return (
      <div className="container max-w-sm mx-auto p-8">
        <Card className="bg-card/50 backdrop-blur border-border/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lock className="w-5 h-5" /> Admin Login
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                login.mutate(
                  { data: { password } },
                  {
                    onSuccess: () => {
                      setPassword("");
                      refetch();
                    },
                  },
                );
              }}
              className="space-y-4"
            >
              <div className="space-y-1">
                <Label htmlFor="pw">Password</Label>
                <Input
                  id="pw"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoFocus
                />
              </div>
              {login.isError && (
                <p className="text-sm text-destructive">Incorrect password.</p>
              )}
              <Button type="submit" className="w-full" disabled={login.isPending || !password}>
                {login.isPending ? "Signing in…" : "Sign in"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container max-w-5xl mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Admin</h1>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            logout.mutate(undefined, {
              onSuccess: () => queryClient.clear(),
            })
          }
        >
          <LogOut className="w-4 h-4" /> Logout
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <ConfigBadge label="API Key" ok={status.apiKeyConfigured} />
        <ConfigBadge label="Database" ok={status.databaseConfigured} />
        <div className="rounded-lg border border-border/50 bg-card/50 p-4">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Rate Limit</div>
          <div className="text-lg font-mono mt-1">{status.requestsPerMinute ?? "—"}/min</div>
        </div>
        <div className="rounded-lg border border-border/50 bg-card/50 p-4">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Order Source</div>
          <div className="text-lg font-mono mt-1">{status.orderDataSource ?? "—"}</div>
        </div>
      </div>

      <SyncSection />

      <ImportSection onCommitted={() => queryClient.invalidateQueries()} />

      <Card className="bg-card/50 backdrop-blur border-border/50">
        <CardHeader>
          <CardTitle className="text-lg">Collectors</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Job</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last Run</TableHead>
                <TableHead className="text-right">Records</TableHead>
                <TableHead className="text-right">Pages</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {status.collectors.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    No collector runs yet.
                  </TableCell>
                </TableRow>
              ) : (
                status.collectors.map((c) => (
                  <TableRow key={c.job}>
                    <TableCell className="font-mono">{c.job}</TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          c.status === "success" && "text-success",
                          c.status === "error" && "text-destructive",
                          c.status === "running" && "text-warning",
                        )}
                      >
                        {c.status}
                      </span>
                      {c.errorSummary && (
                        <div className="text-xs text-destructive">{c.errorSummary}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatRelativeTime(c.lastFinishedAt ?? c.lastRunAt)}
                    </TableCell>
                    <TableCell className="text-right font-mono">{c.recordsInserted ?? "—"}</TableCell>
                    <TableCell className="text-right font-mono">{c.pagesFetched ?? "—"}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="bg-card/50 backdrop-blur border-border/50">
          <CardHeader>
            <CardTitle className="text-lg">Table Counts</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {status.tableCounts.map((t) => (
              <div key={t.table} className="flex justify-between text-sm py-1 border-b border-border/30 last:border-0">
                <span className="font-mono text-muted-foreground">{t.table}</span>
                <span className="font-mono">{t.rows.toLocaleString()}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <WatchedPlayers />
      </div>
    </div>
  );
}

function ConfigBadge({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="rounded-lg border border-border/50 bg-card/50 p-4">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn("text-lg font-medium mt-1", ok ? "text-success" : "text-destructive")}>
        {ok ? "Configured" : "Missing"}
      </div>
    </div>
  );
}

function SyncSection() {
  const queryClient = useQueryClient();
  const sync = useTriggerSync();
  const [activeJob, setActiveJob] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  return (
    <Card className="bg-card/50 backdrop-blur border-border/50">
      <CardHeader>
        <CardTitle className="text-lg">Trigger Sync</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {SYNC_JOBS.map((job) => (
            <Button
              key={job}
              variant="outline"
              size="sm"
              disabled={sync.isPending}
              onClick={() => {
                setActiveJob(job);
                setResult(null);
                sync.mutate(
                  { data: { job } },
                  {
                    onSuccess: (res) => {
                      setResult(
                        `${res.job}: ${res.status} — ${res.recordsInserted} records, ${res.pagesFetched} pages`,
                      );
                      queryClient.invalidateQueries();
                    },
                    onError: () => setResult(`${job}: failed`),
                  },
                );
              }}
            >
              {sync.isPending && activeJob === job ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              {job}
            </Button>
          ))}
        </div>
        {result && <p className="text-sm font-mono text-muted-foreground">{result}</p>}
      </CardContent>
    </Card>
  );
}

const IMPORT_PLACEHOLDER = `[
  {
    "itemId": "diamond_sword",
    "quantity": 1,
    "totalPrice": 50000,
    "soldAt": "2026-06-01T12:00:00Z",
    "sellerName": "Steve"
  }
]`;

function ReportSummary({ report }: { report: ImportReport }) {
  return (
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap gap-x-6 gap-y-1 font-mono">
        <span>Read: {report.rowsRead}</span>
        <span className="text-success">Accepted: {report.accepted}</span>
        <span className="text-destructive">Rejected: {report.rejected}</span>
        {report.duplicates !== undefined && <span className="text-warning">Duplicates: {report.duplicates}</span>}
        <span>{report.committed ? "Committed" : "Preview only"}</span>
      </div>
      {report.errors && report.errors.length > 0 && (
        <div className="max-h-40 overflow-y-auto rounded border border-destructive/30 bg-destructive/5 p-2 space-y-0.5">
          {report.errors.slice(0, 50).map((e, i) => (
            <div key={i} className="text-xs text-destructive font-mono">
              Row {e.row}: {e.error}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ImportSection({ onCommitted }: { onCommitted: () => void }) {
  const [raw, setRaw] = useState("");
  const [filename, setFilename] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const preview = usePreviewImport();
  const commit = useCommitImport();

  function parseRows(): ImportRow[] | null {
    setParseError(null);
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        setParseError("Expected a JSON array of rows.");
        return null;
      }
      return parsed as ImportRow[];
    } catch (e) {
      setParseError(e instanceof Error ? e.message : "Invalid JSON.");
      return null;
    }
  }

  const previewReport = commit.data ?? preview.data;

  return (
    <Card className="bg-card/50 backdrop-blur border-border/50">
      <CardHeader>
        <CardTitle className="text-lg">Import Historical Sales</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Paste a JSON array of sale rows. Required fields per row:{" "}
          <span className="font-mono">itemId</span>, <span className="font-mono">quantity</span>,{" "}
          <span className="font-mono">totalPrice</span>, <span className="font-mono">soldAt</span>.
          Preview validates without writing; Commit persists accepted rows.
        </p>
        <Input
          value={filename}
          onChange={(e) => setFilename(e.target.value)}
          placeholder="Source label (optional, e.g. export-2026-06.json)"
        />
        <textarea
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder={IMPORT_PLACEHOLDER}
          rows={8}
          className="w-full rounded-md border border-border bg-background p-3 font-mono text-xs"
        />
        {parseError && <p className="text-sm text-destructive">{parseError}</p>}
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={preview.isPending || !raw.trim()}
            onClick={() => {
              const rows = parseRows();
              if (!rows) return;
              preview.mutate({ data: { rows, filename: filename || undefined } });
            }}
          >
            {preview.isPending ? "Validating…" : "Preview"}
          </Button>
          <Button
            disabled={commit.isPending || !raw.trim()}
            onClick={() => {
              const rows = parseRows();
              if (!rows) return;
              commit.mutate(
                { data: { rows, filename: filename || undefined } },
                { onSuccess: onCommitted },
              );
            }}
          >
            {commit.isPending ? "Committing…" : "Commit"}
          </Button>
        </div>
        {previewReport && <ReportSummary report={previewReport} />}
      </CardContent>
    </Card>
  );
}

function WatchedPlayers() {
  const queryClient = useQueryClient();
  const { data: players } = useGetWatchedPlayers();
  const add = useAddWatchedPlayer();
  const remove = useRemoveWatchedPlayer();
  const [username, setUsername] = useState("");

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["/api/admin/watched-players"] });

  return (
    <Card className="bg-card/50 backdrop-blur border-border/50">
      <CardHeader>
        <CardTitle className="text-lg">Watched Players</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!username) return;
            add.mutate(
              { data: { username } },
              {
                onSuccess: () => {
                  setUsername("");
                  invalidate();
                },
              },
            );
          }}
        >
          <Input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Username"
          />
          <Button type="submit" disabled={add.isPending || !username}>
            Add
          </Button>
        </form>
        <div className="divide-y divide-border/30">
          {(players ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">No watched players.</p>
          ) : (
            (players ?? []).map((p) => (
              <div key={p.username} className="flex items-center justify-between py-2">
                <div>
                  <span className="font-medium">{p.username}</span>
                  <span className="text-xs text-muted-foreground ml-2">
                    {formatRelativeTime(p.addedAt)}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    remove.mutate(
                      { username: p.username },
                      { onSuccess: invalidate },
                    )
                  }
                >
                  <Trash2 className="w-4 h-4 text-destructive" />
                </Button>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
