import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "wouter";
import { AlertTriangle } from "lucide-react";

export default function AboutPage() {
  return (
    <div className="container max-w-3xl mx-auto p-4 sm:p-6 lg:p-8 space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">About</h1>
        <p className="text-muted-foreground mt-2">
          Donut Market Terminal is a fan-made analytics dashboard for the DonutSMP in-game economy.
        </p>
      </div>

      <div className="rounded-lg border border-warning/40 bg-warning/5 p-5 flex gap-3">
        <AlertTriangle className="w-6 h-6 text-warning flex-shrink-0" />
        <div className="text-sm text-muted-foreground space-y-1">
          <p className="font-semibold text-foreground">Unofficial &amp; unaffiliated</p>
          <p>
            This project is not affiliated with, endorsed by, or sponsored by DonutSMP. All
            trademarks belong to their respective owners. Prices are estimates derived from public
            auction data and may be inaccurate or out of date.
          </p>
        </div>
      </div>

      <Card className="bg-card/50 backdrop-blur border-border/50">
        <CardHeader>
          <CardTitle className="text-lg">What it does</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            The terminal tracks item prices, auction activity, player leaderboards, and lets you
            simulate trades. It aims to give players a clearer picture of market trends without
            scraping or interfering with the game.
          </p>
          <p>
            See the{" "}
            <Link href="/data">
              <span className="text-primary hover:underline cursor-pointer">Data &amp; Methodology</span>
            </Link>{" "}
            page for how the numbers are produced.
          </p>
        </CardContent>
      </Card>

      <Card className="bg-card/50 backdrop-blur border-border/50">
        <CardHeader>
          <CardTitle className="text-lg">Responsible use</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            Data is fetched through a rate-limited server-side client that respects the upstream API.
            We never expose credentials to the browser and never touch moderation endpoints.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
