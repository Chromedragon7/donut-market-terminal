import { useGetSetupStatus } from "@workspace/api-client-react";
import { AlertCircle, Database, Key } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";

export function SetupBanner() {
  const { data: status, isLoading } = useGetSetupStatus();

  if (isLoading || !status) return null;

  const isConfigured = status.apiKeyConfigured && status.databaseConfigured;
  const hasData = status.hasData;

  if (isConfigured && hasData && !status.stale) return null;

  return (
    <div className="bg-destructive/10 border-b border-destructive/20 p-4">
      <div className="container max-w-7xl mx-auto flex flex-col sm:flex-row gap-4 items-center justify-between">
        <div className="flex items-center gap-3 text-destructive-foreground">
          <AlertCircle className="w-5 h-5 text-destructive" />
          <div className="text-sm">
            {!isConfigured ? (
              <span className="font-semibold text-destructive">System Not Configured: </span>
            ) : !hasData ? (
              <span className="font-semibold text-warning">No Data Available: </span>
            ) : status.stale ? (
              <span className="font-semibold text-warning">Stale Data: </span>
            ) : null}
            
            {!status.apiKeyConfigured && "Missing API Key. "}
            {!status.databaseConfigured && "Missing Database Configuration. "}
            {isConfigured && !hasData && "Collectors have not run yet or database is empty. "}
            {isConfigured && hasData && status.stale && "Data has not been updated recently. "}
            
            An admin needs to configure the system.
          </div>
        </div>
        <Link href="/admin">
          <Button variant="outline" size="sm" className="shrink-0 bg-background/50 backdrop-blur">
            Go to Admin
          </Button>
        </Link>
      </div>
    </div>
  );
}
