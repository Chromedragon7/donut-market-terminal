import {
  defineRailway,
  group,
  postgres,
  project,
  service,
} from "railway/iac";

export default defineRailway((context) => {
  const database = postgres("postgres");

  const api = service("api", {
    build: "pnpm --filter @donut/api... build",
    start: "pnpm --filter @donut/db migrate && pnpm --filter @donut/api start",
    healthcheck: "/health/ready",
    healthcheckTimeout: 120,
    replicas: 1,
    env: {
      NODE_ENV: "production",
      DATABASE_URL: database.env.DATABASE_URL,
      DATABASE_SSL: "false",
      OWNER_USERNAME: context.shared.OWNER_USERNAME,
      OWNER_PASSWORD_HASH: context.shared.OWNER_PASSWORD_HASH,
      TOKEN_HASH_SECRET: context.shared.TOKEN_HASH_SECRET,
      SELLER_PSEUDONYM_SECRET: context.shared.SELLER_PSEUDONYM_SECRET,
      METRICS_BEARER_TOKEN: context.shared.METRICS_BEARER_TOKEN,
      PUBLIC_APP_ORIGIN: context.shared.PUBLIC_APP_ORIGIN,
      COOKIE_SECURE: "true",
      EXPOSE_OPENAPI: "false",
      DATABASE_MAX_CONNECTIONS: "10",
      OUTBOX_POLL_MS: "1000",
    },
  });

  const collector = service("collector", {
    build: "pnpm --filter @donut/collector... build",
    start: "pnpm --filter @donut/collector start",
    // Liveness avoids a rolling-deploy deadlock while the previous replica owns the lease.
    // Monitor /health/ready separately for database, leader, and upstream authorization state.
    healthcheck: "/health/live",
    healthcheckTimeout: 120,
    replicas: 1,
    env: {
      NODE_ENV: "production",
      DATABASE_URL: database.env.DATABASE_URL,
      PGSSLMODE: "disable",
      DONUT_API_BASE_URL: context.shared.DONUT_API_BASE_URL,
      DONUT_API_KEY: context.shared.DONUT_API_KEY,
      DONUT_SOURCE_KEY: "donut-compatible-mirror",
      DONUT_SOURCE_DISPLAY_NAME: "Donut-compatible mirror",
      COLLECTOR_MODE: "continuous",
      COLLECTOR_TRANSACTION_PAGES: "10",
      COLLECTOR_TRANSACTION_POLL_MS: "15000",
      COLLECTOR_LISTING_ENABLED: "false",
      COLLECTOR_LISTING_MAX_PAGES: "25",
      COLLECTOR_LISTING_SCAN_BUDGET_MS: "10000",
      COLLECTOR_LISTING_POLL_MS: "60000",
      COLLECTOR_REQUESTS_PER_MINUTE: "200",
      COLLECTOR_TRANSACTION_RESERVE_PERCENT: "60",
      COLLECTOR_MAX_RUN_BACKOFF_MS: "300000",
      COLLECTOR_LEASE_TTL_MS: "60000",
    },
  });

  const web = service("web", {
    build: "pnpm --filter @donut/web build",
    start: "pnpm --filter @donut/web start",
    healthcheck: "/",
    healthcheckTimeout: 120,
    replicas: 1,
    env: {
      NODE_ENV: "production",
      NEXT_PUBLIC_API_ORIGIN: context.shared.NEXT_PUBLIC_API_ORIGIN,
      NEXT_PUBLIC_SITE_ORIGIN: context.shared.NEXT_PUBLIC_SITE_ORIGIN,
    },
  });

  return project("donut-market-intelligence", {
    resources: [group("Backend", [database, api, collector]), web],
  });
});
