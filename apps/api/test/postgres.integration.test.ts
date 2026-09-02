import assert from "node:assert/strict";
import { test } from "node:test";
import { createPostgresMarketRepository } from "../src/postgres-repository.js";

const connectionString = process.env.API_POSTGRES_TEST_URL;

test("PostgreSQL adapter reports migrated schema readiness", { skip: connectionString === undefined }, async () => {
  assert.ok(connectionString);
  const repository = await createPostgresMarketRepository({
    connectionString,
    ownerUsername: "api-integration-owner@example.invalid",
    ownerPasswordHash: "scrypt$integration-test-placeholder",
  });
  try {
    const readiness = await repository.readiness();
    assert.equal(readiness.ready, true);
  } finally {
    await repository.close();
  }
});
