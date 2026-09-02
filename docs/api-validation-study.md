# Compatible API validation study

The published compatible contract and community observations are hypotheses for the configured mirror, not measured facts. Production polling intervals must remain provisional until a controlled 48–72-hour study is completed with the user's own securely configured `DONUT_API_KEY`.

No real mirror measurements are included in this repository.

## Current laboratory capability

The adapter and collector can already preserve the evidence needed for part of the study:

- Successful and failed request counts, attempts, HTTP state, and typed error categories.
- Request latency and response byte count per page.
- Safe `Retry-After`, `RateLimit-*`, and `X-RateLimit-*` response headers.
- Received, new, duplicate, invalid, and partial record counts.
- Oldest and newest transaction timestamps seen in a completed scan.
- Raw lossless page bodies, content hashes, validation issues, and quarantine evidence.
- Per-field presence/null state used in variant completeness classification.
- Page numbers, positions, null padding, and completed-page lists.

`COLLECTOR_MODE=validation` currently runs one transaction scan and, if explicitly enabled, one listing scan. It does not keep itself alive for 48–72 hours and does not generate a study report. The Collection website deliberately shows study progress as zero until a real study runner exists.

## Safe study procedure

1. Use an isolated staging Railway environment and staging PostgreSQL database. Do not point experiments at production history.
2. Put `DONUT_API_KEY` only in the collector's secret variables. Confirm it is absent from web/API variables, logs, screenshots, and exports.
3. Start with listings disabled and conservative request values below the published ceiling. Confirm authorization, response shape, and transaction-window behavior.
4. Enable broad listing collection only after the transaction lane is stable. Keep transaction capacity reserved.
5. Run continuous collection for at least 48–72 hours. Record the exact start/end time, configuration versions, deployment revision, and any manual interruption.
6. Take an off-platform logical backup before exploratory analysis. Query retained evidence; do not edit or delete raw observations.
7. Review a report, approve new defaults, and then promote configuration through a separate deployment.

Do not use `--once` for a long study because it forces `one_shot` mode. The current collector has no runtime settings endpoint; configuration changes require a controlled restart.

## Required report

The eventual report generator must use retained evidence and include:

| Measurement | Current evidence | Remaining work |
| --- | --- | --- |
| Success/failure/auth/throttle counts | Durable requests and runs | Group by time and configuration version |
| Latency and response size | Stored per request | Percentiles and time-of-day distribution |
| New transactions/minute and duplicates | Run counts and logical transactions | Study-window rollup |
| Oldest transaction and rolling-window turnover | Checkpoint timestamps | Derive turnover duration and uncertainty |
| Page overlap, reorder, and consistency | Page positions/raw bodies | Deterministic cross-page/cross-scan analyzer |
| Metadata completeness and field-shape changes | Validation issues, field states, raw bodies | Versioned schema-drift summary |
| Listing appearance delay | Not measured | Controlled, non-transactional observation protocol |
| Completed-sale appearance delay | Not measured | Correlation protocol with an independently observed sale time |
| Processing and browser/mod delivery time | Partial timestamps only | End-to-end trace timestamps |

Listing and sale appearance-delay experiments must not buy, sell, list, execute commands, or automate a Minecraft GUI. If a controlled action is ever needed, it requires separate explicit permission and a documented protocol.

## Decision rules

Do not call a source complete merely because requests succeeded. A study result must state the observed period, sample counts, missing intervals, collector version, rate settings, and confidence. Defaults should preserve enough capacity to scan the rolling transaction window before observed turnover under a conservative failure margin.

Stop or reduce the study if authentication failures, persistent throttling, an unexpected response contract, redistribution concerns, or server rules make continued collection inappropriate. Preserve the evidence and record a gap; do not retry aggressively.

The resulting report must not contain bearer tokens, authorization headers, database credentials, raw private configuration, or seller identities unless access is strictly owner-only and necessary for the analysis.
