import { randomUUID } from "node:crypto";
import type { GapInput, JsonValue } from "@donut/db";

export function detectTransactionWindowGap(
  previousNewestValue: JsonValue | undefined,
  previousLastSuccessAt: Date | null,
  currentOldest: bigint,
  sourceId: string,
  currentRunId: string,
  detectedAt: Date,
): GapInput | undefined {
  if (previousLastSuccessAt === null || typeof previousNewestValue !== "string") return undefined;
  if (!/^\d+$/.test(previousNewestValue)) return undefined;
  const previousNewest = BigInt(previousNewestValue);
  if (previousNewest <= 0n || currentOldest <= previousNewest) return undefined;
  return {
    id: randomUUID(),
    sourceId,
    resource: "auction_transactions",
    gapStart: new Date(Number(previousNewest)),
    gapEnd: new Date(Number(currentOldest)),
    detectedAt,
    reason: "transaction_window_no_overlap",
    confidence: "confirmed",
    detectionVersion: "transaction-window-continuity/v1",
    evidence: {
      previousLastSuccessAt: previousLastSuccessAt.toISOString(),
      previousNewestSourceTimestampMs: previousNewest.toString(),
      currentOldestSourceTimestampMs: currentOldest.toString(),
      accessibleTransactionPages: 10,
    },
    lastRunId: currentRunId,
  };
}
