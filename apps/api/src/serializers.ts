import type {
  ExportBundle,
  ListingRecord,
  OutboxEvent,
  SaleRecord,
  SellerPrivacyPolicy,
  UserRole,
} from "./contracts.js";
import { applySellerPrivacy, type SellerView } from "./security.js";

export type ListingView = Omit<ListingRecord, "seller"> & { seller: SellerView };
export type SaleView = Omit<SaleRecord, "seller"> & { seller: SellerView };

export interface PrivacyContext {
  role: UserRole;
  policy: SellerPrivacyPolicy;
  pseudonymSecret: string;
}

export function serializeListing(record: ListingRecord, context: PrivacyContext): ListingView {
  const { seller, ...safe } = record;
  return {
    ...safe,
    seller: applySellerPrivacy(seller, context.role, context.policy, context.pseudonymSecret),
  };
}

export function serializeSale(record: SaleRecord, context: PrivacyContext): SaleView {
  const { seller, ...safe } = record;
  return {
    ...safe,
    seller: applySellerPrivacy(seller, context.role, context.policy, context.pseudonymSecret),
  };
}

function sanitizeUnknown(value: unknown, context: PrivacyContext): unknown {
  if (Array.isArray(value)) return value.map((entry) => sanitizeUnknown(entry, context));
  if (value === null || typeof value !== "object") return value;
  const candidate = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(candidate)) {
    const lowerKey = key.toLowerCase();
    if (/password|secret|token|api[_-]?key/.test(lowerKey)) continue;
    if (lowerKey === "seller") {
      const seller = entry !== null && typeof entry === "object" ? entry as Record<string, unknown> : {};
      result.seller = applySellerPrivacy(
        {
          name: typeof seller.name === "string" ? seller.name : null,
          uuid: typeof seller.uuid === "string" ? seller.uuid : null,
        },
        context.role,
        context.policy,
        context.pseudonymSecret,
      );
      continue;
    }
    if (lowerKey.includes("seller")) continue;
    result[key] = sanitizeUnknown(entry, context);
  }
  return result;
}

export function serializeOutboxEvent(event: OutboxEvent, context: PrivacyContext): OutboxEvent {
  return {
    cursor: event.cursor,
    audience: event.audience,
    type: event.type,
    occurredAt: event.occurredAt,
    payload: sanitizeUnknown(event.payload, context) as Record<string, unknown>,
  };
}

export function serializeExport(bundle: ExportBundle, context: PrivacyContext) {
  return {
    generatedAt: bundle.generatedAt,
    schemaVersion: "1",
    units: { price: "server_currency", timestamps: "RFC3339 UTC" },
    notices: [
      "Active asks are not completed sales.",
      "Recorded volume may not equal total market volume.",
      "No buyer data is available from the documented compatible API.",
    ],
    items: bundle.items,
    listings: bundle.listings.map((record) => serializeListing(record, context)),
    sales: bundle.sales.map((record) => serializeSale(record, context)),
    watchlists: bundle.watchlists,
    alerts: bundle.alerts,
    dashboards: bundle.dashboards,
  };
}
