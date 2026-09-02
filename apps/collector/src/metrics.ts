export interface CollectorMetricsSnapshot {
  readonly startedAt: string;
  readonly requests: number;
  readonly responses: number;
  readonly receivedRecords: number;
  readonly newRecords: number;
  readonly duplicateRecords: number;
  readonly invalidRecords: number;
  readonly throttles: number;
  readonly authenticationFailures: number;
  readonly upstreamFailures: number;
  readonly databaseFailures: number;
  readonly transactionRuns: number;
  readonly listingRuns: number;
  readonly partialRuns: number;
  readonly lastRequestAt: string | null;
  readonly lastSuccessAt: string | null;
  readonly lastNewTransactionAt: string | null;
  readonly latencyCount: number;
  readonly latencyTotalMs: number;
  readonly latencyMaximumMs: number;
}

export class CollectorMetrics {
  private readonly startedAt = new Date();
  private requests = 0;
  private responses = 0;
  private receivedRecords = 0;
  private newRecords = 0;
  private duplicateRecords = 0;
  private invalidRecords = 0;
  private throttles = 0;
  private authenticationFailures = 0;
  private upstreamFailures = 0;
  private databaseFailures = 0;
  private transactionRuns = 0;
  private listingRuns = 0;
  private partialRuns = 0;
  private lastRequestAt: Date | null = null;
  private lastSuccessAt: Date | null = null;
  private lastNewTransactionAt: Date | null = null;
  private latencyCount = 0;
  private latencyTotalMs = 0;
  private latencyMaximumMs = 0;

  public recordRequest(count = 1): void {
    if (!Number.isSafeInteger(count) || count < 1) throw new RangeError("Request count must be positive");
    this.requests += count;
    this.lastRequestAt = new Date();
  }

  public recordResponse(latencyMs: number): void {
    this.responses += 1;
    if (Number.isFinite(latencyMs) && latencyMs >= 0) {
      this.latencyCount += 1;
      this.latencyTotalMs += latencyMs;
      this.latencyMaximumMs = Math.max(this.latencyMaximumMs, latencyMs);
    }
  }

  public recordRecords(
    resource: "transactions" | "listings",
    received: number,
    added: number,
    duplicates: number,
    invalid: number,
  ): void {
    this.receivedRecords += received;
    this.newRecords += added;
    this.duplicateRecords += duplicates;
    this.invalidRecords += invalid;
    if (resource === "transactions" && added > 0) this.lastNewTransactionAt = new Date();
  }

  public recordRun(resource: "transactions" | "listings", partial: boolean): void {
    if (resource === "transactions") this.transactionRuns += 1;
    else this.listingRuns += 1;
    if (partial) this.partialRuns += 1;
    if (!partial) this.lastSuccessAt = new Date();
  }

  public recordFailure(kind: "throttle" | "authentication" | "upstream" | "database"): void {
    if (kind === "throttle") this.throttles += 1;
    else if (kind === "authentication") this.authenticationFailures += 1;
    else if (kind === "upstream") this.upstreamFailures += 1;
    else this.databaseFailures += 1;
  }

  public snapshot(): CollectorMetricsSnapshot {
    return Object.freeze({
      startedAt: this.startedAt.toISOString(),
      requests: this.requests,
      responses: this.responses,
      receivedRecords: this.receivedRecords,
      newRecords: this.newRecords,
      duplicateRecords: this.duplicateRecords,
      invalidRecords: this.invalidRecords,
      throttles: this.throttles,
      authenticationFailures: this.authenticationFailures,
      upstreamFailures: this.upstreamFailures,
      databaseFailures: this.databaseFailures,
      transactionRuns: this.transactionRuns,
      listingRuns: this.listingRuns,
      partialRuns: this.partialRuns,
      lastRequestAt: this.lastRequestAt?.toISOString() ?? null,
      lastSuccessAt: this.lastSuccessAt?.toISOString() ?? null,
      lastNewTransactionAt: this.lastNewTransactionAt?.toISOString() ?? null,
      latencyCount: this.latencyCount,
      latencyTotalMs: this.latencyTotalMs,
      latencyMaximumMs: this.latencyMaximumMs,
    });
  }
}
