# Minecraft mod version matrix and deferred features

No mod artifact is built yet because the target Minecraft version, server Java version, loader, loader version, mappings, and compatible dependency versions are unknown.

| Requirement | Status |
| --- | --- |
| Target Java Edition version | Unknown; must be observed/confirmed |
| Server/client Java runtime | Unknown |
| Fabric/alternative loader and version | Unknown |
| Mapping/API versions | Deferred until the exact client version is known |
| Hosted API authentication | Implemented contract: scoped, revocable read-only mod token |
| Market reads and resumable updates | Implemented hosted API contract |
| Tooltip/panel/held-item UI | Deferred until version matrix is confirmed |
| Passive Orders/metadata observation | Disabled; requires explicit permission and separate signed provider |
| Buying, selling, listing, commands, GUI automation | Not implemented and disabled |

The first mod must fail closed when the backend is unavailable, redact its token, use TLS, show source/freshness/confidence/sample size, distinguish asks from sales, and never contain the compatible upstream key. Future observation submissions must be authenticated, versioned, quarantined, rate-limited, and kept visibly separate from compatible-API data.
