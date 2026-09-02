# Security model

The dashboard is private by default. Passwords use Node's built-in scrypt with per-password random salt. Session and mod tokens are random opaque values; only keyed hashes are stored, and revocation/expiry is checked on every request. Session cookies are HttpOnly, Secure in production, SameSite Strict, and paired with exact-origin plus double-submit CSRF protection.

Seller privacy is applied before listing, sale, export, or outbox serialization. Owners may see full source identity; invited users use their configured `name`, `pseudonymized`, or `hidden` policy. Arbitrary outbox payload keys resembling secrets/tokens/passwords or seller-derived fields are removed.

Other controls include strict JSON schemas, bounded inputs/pages, CSP and security headers, CORS allowlists, global and login/stream rate limits, separate metrics authentication, request ids, generic credential errors, structured-log redaction, owner-only collection health, and read-only scoped mod tokens.

Residual operational duties: TLS termination, dependency/audit patching, database least privilege, encrypted backups, secret rotation, access/audit logs for sensitive settings, migration review, outbox payload review, and denial-of-service monitoring. Never add arbitrary URL fetching, browser/mod upstream access, automatic Minecraft actions, or unverified client observations.
