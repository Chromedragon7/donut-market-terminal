export class ApiMetrics {
  private readonly startedAt = Date.now();
  private requestCount = 0;
  private responseErrorCount = 0;
  private authenticationFailureCount = 0;
  private rateLimitCount = 0;
  private activeStreams = 0;

  recordResponse(statusCode: number): void {
    this.requestCount += 1;
    if (statusCode >= 500) this.responseErrorCount += 1;
    if (statusCode === 429) this.rateLimitCount += 1;
  }

  recordAuthenticationFailure(): void {
    this.authenticationFailureCount += 1;
  }

  openStream(): void {
    this.activeStreams += 1;
  }

  closeStream(): void {
    this.activeStreams = Math.max(0, this.activeStreams - 1);
  }

  toPrometheus(): string {
    const uptime = Math.floor((Date.now() - this.startedAt) / 1000);
    return [
      "# HELP donut_api_uptime_seconds Process uptime in seconds.",
      "# TYPE donut_api_uptime_seconds gauge",
      `donut_api_uptime_seconds ${uptime}`,
      "# HELP donut_api_requests_total Completed HTTP requests.",
      "# TYPE donut_api_requests_total counter",
      `donut_api_requests_total ${this.requestCount}`,
      "# HELP donut_api_server_errors_total HTTP 5xx responses.",
      "# TYPE donut_api_server_errors_total counter",
      `donut_api_server_errors_total ${this.responseErrorCount}`,
      "# HELP donut_api_authentication_failures_total Failed authentication attempts.",
      "# TYPE donut_api_authentication_failures_total counter",
      `donut_api_authentication_failures_total ${this.authenticationFailureCount}`,
      "# HELP donut_api_rate_limit_responses_total HTTP 429 responses.",
      "# TYPE donut_api_rate_limit_responses_total counter",
      `donut_api_rate_limit_responses_total ${this.rateLimitCount}`,
      "# HELP donut_api_live_stream_connections Active SSE connections.",
      "# TYPE donut_api_live_stream_connections gauge",
      `donut_api_live_stream_connections ${this.activeStreams}`,
      "",
    ].join("\n");
  }
}
