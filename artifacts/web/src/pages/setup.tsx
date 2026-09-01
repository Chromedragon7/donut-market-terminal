import { useGetSetupStatus } from "@workspace/api-client-react";
import { Link } from "wouter";
import { CheckCircle2, XCircle, Key, Database, ShieldCheck, Activity, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function CheckRow({
  ok,
  label,
  detail,
  icon: Icon,
}: {
  ok: boolean;
  label: string;
  detail: string;
  icon: typeof Key;
}) {
  return (
    <div className="flex items-start gap-3 py-3 border-b border-border/50 last:border-0">
      <Icon className="w-5 h-5 mt-0.5 text-muted-foreground shrink-0" />
      <div className="flex-1">
        <div className="font-medium">{label}</div>
        <div className="text-sm text-muted-foreground">{detail}</div>
      </div>
      {ok ? (
        <CheckCircle2 className="w-5 h-5 text-success shrink-0" />
      ) : (
        <XCircle className="w-5 h-5 text-destructive shrink-0" />
      )}
    </div>
  );
}

export default function SetupPage() {
  const { data: status, isLoading } = useGetSetupStatus();

  return (
    <div className="container max-w-2xl mx-auto px-4 py-12">
      <h1 className="text-2xl font-bold mb-2">Setup</h1>
      <p className="text-muted-foreground mb-8">
        Donut Market Terminal needs a few things configured before it can show live data.
      </p>

      <Card className="bg-card/50 backdrop-blur border-border/50">
        <CardHeader>
          <CardTitle className="text-lg">Configuration Status</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading || !status ? (
            <div className="text-sm text-muted-foreground py-6 text-center">
              Checking configuration…
            </div>
          ) : (
            <>
              <CheckRow
                ok={status.apiKeyConfigured}
                label="DonutSMP API Key"
                detail="Server-only key used to collect market data. Set DONUTSMP_API_KEY as a secret."
                icon={Key}
              />
              <CheckRow
                ok={status.databaseConfigured}
                label="Database"
                detail="PostgreSQL connection (DATABASE_URL) where all collected data is stored."
                icon={Database}
              />
              <CheckRow
                ok={status.adminConfigured}
                label="Admin Access"
                detail="ADMIN_PASSWORD and SESSION_SECRET enable the admin console and collectors."
                icon={ShieldCheck}
              />
              <CheckRow
                ok={status.hasData}
                label="Collected Data"
                detail="Run the collectors from the Admin page to populate prices, auctions, and leaderboards."
                icon={Activity}
              />
            </>
          )}
        </CardContent>
      </Card>

      <div className="mt-6 flex gap-3">
        <Link href="/admin">
          <Button>
            <Settings className="w-4 h-4 mr-2" />
            Go to Admin
          </Button>
        </Link>
        <Link href="/data">
          <Button variant="outline">Methodology</Button>
        </Link>
      </div>
    </div>
  );
}
