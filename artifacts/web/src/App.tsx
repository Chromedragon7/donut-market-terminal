import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppShell } from "@/components/layout/AppShell";
import NotFound from "@/pages/not-found";

import Home from "@/pages/home";
import Screener from "@/pages/market";
import Auctions from "@/pages/auctions";
import ItemDetail from "@/pages/item-detail";
import Leaderboards from "@/pages/leaderboards";
import PlayerProfile from "@/pages/player";
import DataPage from "@/pages/data";
import AboutPage from "@/pages/about";
import AdminPage from "@/pages/admin";
import SetupPage from "@/pages/setup";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

function Router() {
  return (
    <AppShell>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/market" component={Screener} />
        <Route path="/auctions" component={Auctions} />
        <Route path="/items/:scopeKey" component={ItemDetail} />
        <Route path="/leaderboards" component={Leaderboards} />
        <Route path="/players/:username" component={PlayerProfile} />
        <Route path="/data" component={DataPage} />
        <Route path="/about" component={AboutPage} />
        <Route path="/admin" component={AdminPage} />
        <Route path="/setup" component={SetupPage} />
        <Route component={NotFound} />
      </Switch>
    </AppShell>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
