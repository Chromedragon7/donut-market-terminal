import type { Lease } from "@donut/db";
import type { CollectorConfig } from "./config.js";
import type { MarketCollector } from "./ingestion.js";
import { abortableSleep, RunBackoff } from "./rate-budget.js";
import { logEvent } from "./redaction.js";
import type { CollectorStore, RunOutcome } from "./types.js";

export interface SchedulerCallbacks {
  readonly onLeader?: (leader: boolean) => void;
  readonly onRun?: (outcome: RunOutcome) => void;
}

export class CollectorScheduler {
  private readonly transactionBackoff: RunBackoff;
  private readonly listingBackoff: RunBackoff;

  public constructor(
    private readonly collector: MarketCollector,
    private readonly store: CollectorStore,
    private readonly sourceId: string,
    private readonly config: CollectorConfig,
    private readonly callbacks: SchedulerCallbacks = {},
  ) {
    this.transactionBackoff = new RunBackoff(1_000, config.maxRunBackoffMs);
    this.listingBackoff = new RunBackoff(2_000, config.maxRunBackoffMs);
  }

  public async run(signal?: AbortSignal): Promise<void> {
    const leaseKey = `collector:${this.sourceId}:scheduler`;
    const advisory = await this.store.withAdvisoryLock(
      leaseKey,
      async (advisorySignal) => {
        await this.runAsLeader(
          leaseKey,
          signal === undefined ? advisorySignal : AbortSignal.any([signal, advisorySignal]),
        );
        if (advisorySignal.aborted) throw abortReason(advisorySignal, "Collector advisory lock was lost");
      },
    );
    if (!advisory.acquired) {
      this.callbacks.onLeader?.(false);
      logEvent("warn", "collector_advisory_lock_not_acquired", { sourceId: this.sourceId });
    }
  }

  private async runAsLeader(leaseKey: string, signal?: AbortSignal): Promise<void> {
    let lease = await this.store.acquireLease(leaseKey, this.config.instanceId, this.config.leaseTtlMs);
    if (lease === null) {
      this.callbacks.onLeader?.(false);
      logEvent("warn", "collector_leader_not_acquired", { sourceId: this.sourceId });
      return;
    }

    this.callbacks.onLeader?.(true);
    const leaseLost = new AbortController();
    const combinedSignal = signal === undefined
      ? leaseLost.signal
      : AbortSignal.any([signal, leaseLost.signal]);
    const heartbeat = this.startHeartbeat(lease, leaseLost, (renewed) => { lease = renewed; });

    try {
      const abandoned = await this.store.markAbandonedRunsPartial(
        this.sourceId,
        this.config.instanceId,
        new Date(Date.now() - this.config.leaseTtlMs),
      );
      if (abandoned > 0) {
        logEvent("warn", "abandoned_collection_runs_recovered", { count: abandoned });
      }
      if (this.config.mode === "one_shot" || this.config.mode === "validation") {
        await this.runOnce(combinedSignal);
      } else {
        await this.runContinuously(combinedSignal);
      }
      if (leaseLost.signal.aborted) {
        throw abortReason(leaseLost.signal, "Collector scheduler lease was lost");
      }
    } finally {
      clearInterval(heartbeat);
      try {
        await this.store.releaseLease(lease);
      } finally {
        this.callbacks.onLeader?.(false);
      }
    }
  }

  private async runOnce(signal: AbortSignal): Promise<void> {
    const transactions = await this.collector.scanTransactions(signal);
    this.callbacks.onRun?.(transactions);
    const outcomes: RunOutcome[] = [transactions];
    if (this.config.listingEnabled && !signal.aborted && transactions.status !== "failed") {
      const listings = await this.collector.scanListings(signal);
      outcomes.push(listings);
      this.callbacks.onRun?.(listings);
    }
    if (!signal.aborted && outcomes.some((outcome) => outcome.status !== "succeeded")) {
      throw new Error(`One-shot collection did not complete successfully: ${outcomes.map(
        (outcome) => `${outcome.resource}=${outcome.status}`,
      ).join(", ")}`);
    }
  }

  private async runContinuously(signal: AbortSignal): Promise<void> {
    let nextTransactionAt = 0;
    let nextListingAt = this.config.listingEnabled ? 0 : Number.POSITIVE_INFINITY;

    while (!signal.aborted) {
      const now = Date.now();
      // Continuity always wins when both resources are due.
      if (now >= nextTransactionAt) {
        const outcome = await this.collector.scanTransactions(signal);
        this.callbacks.onRun?.(outcome);
        if (outcome.status === "succeeded") {
          this.transactionBackoff.reset();
          nextTransactionAt = Date.now() + this.config.transactionPollMs;
        } else if (outcome.status === "cancelled") {
          break;
        } else {
          nextTransactionAt = Date.now() + this.transactionBackoff.nextDelay();
        }
        continue;
      }

      if (this.config.listingEnabled && now >= nextListingAt) {
        const outcome = await this.collector.scanListings(signal);
        this.callbacks.onRun?.(outcome);
        if (outcome.status === "succeeded") {
          this.listingBackoff.reset();
          nextListingAt = Date.now() + this.config.listingPollMs;
        } else if (outcome.status === "cancelled") {
          break;
        } else {
          nextListingAt = Date.now() + this.listingBackoff.nextDelay();
        }
        continue;
      }

      const wakeAt = Math.min(nextTransactionAt, nextListingAt);
      await abortableSleep(Math.max(1, Math.min(1_000, wakeAt - now)), signal);
    }
  }

  private startHeartbeat(
    initialLease: Lease,
    abortController: AbortController,
    update: (lease: Lease) => void,
  ): NodeJS.Timeout {
    let current = initialLease;
    let renewing = false;
    const interval = setInterval(() => {
      if (renewing || abortController.signal.aborted) return;
      renewing = true;
      void this.store.renewLease(current, this.config.leaseTtlMs)
        .then((renewed) => {
          if (renewed === null) {
            abortController.abort(new Error("Collector scheduler lease was lost"));
            return;
          }
          current = renewed;
          update(renewed);
        })
        .catch((error: unknown) => {
          logEvent("error", "collector_lease_renewal_failed", {
            message: error instanceof Error ? error.message : "Unknown lease renewal failure",
          });
          abortController.abort(new Error("Collector scheduler lease renewal failed"));
        })
        .finally(() => { renewing = false; });
    }, Math.max(1_000, Math.floor(this.config.leaseTtlMs / 3)));
    interval.unref();
    return interval;
  }
}

function abortReason(signal: AbortSignal, fallback: string): Error {
  return signal.reason instanceof Error ? signal.reason : new Error(fallback);
}
