import { describe, expect, it } from "vitest";
import { loadCollectorConfig, publicCollectorConfig } from "./config.js";
import { redact } from "./redaction.js";

describe("collector configuration", () => {
  it("keeps all secrets out of its public projection", () => {
    const config = loadCollectorConfig({
      DATABASE_URL: "postgresql://private-db.invalid/market",
      DONUT_API_BASE_URL: "https://mirror.example.test",
      DONUT_API_KEY: "fake-test-token",
      NODE_ENV: "production",
    }, ["--once"]);
    const rendered = JSON.stringify(publicCollectorConfig(config));
    expect(rendered).not.toContain("fake-test-token");
    expect(rendered).not.toContain("private-db");
  });

  it("rejects insecure non-local upstream URLs in production", () => {
    expect(() => loadCollectorConfig({
      DATABASE_URL: "postgresql://database.invalid/market",
      DONUT_API_BASE_URL: "http://mirror.example.test",
      DONUT_API_KEY: "fake-test-token",
      NODE_ENV: "production",
    })).toThrow("must use HTTPS");
  });

  it("redacts nested credential-shaped fields and Error messages", () => {
    const value = redact({
      authorization: "Bearer fake-test-token",
      nested: { apiKey: "fake-test-token" },
      error: new Error("safe message"),
    });
    expect(JSON.stringify(value)).toBe(
      '{"authorization":"[REDACTED]","nested":{"apiKey":"[REDACTED]"},"error":{"name":"Error","message":"safe message"}}',
    );
  });
});
