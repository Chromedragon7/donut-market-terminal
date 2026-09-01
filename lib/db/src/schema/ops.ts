import {
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const syncRuns = pgTable("sync_runs", {
  id: serial("id").primaryKey(),
  jobType: text("job_type").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  status: text("status").notNull().default("running"),
  upstreamRequestCount: integer("upstream_request_count").notNull().default(0),
  pagesFetched: integer("pages_fetched").notNull().default(0),
  recordsSeen: integer("records_seen").notNull().default(0),
  recordsInserted: integer("records_inserted").notNull().default(0),
  recordsUpdated: integer("records_updated").notNull().default(0),
  complete: text("complete").notNull().default("complete"),
  errorSummary: text("error_summary"),
  lastCursor: text("last_cursor"),
});

export const dataImports = pgTable("data_imports", {
  id: serial("id").primaryKey(),
  filename: text("filename").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  status: text("status").notNull().default("pending"),
  rowsRead: integer("rows_read").notNull().default(0),
  rowsAccepted: integer("rows_accepted").notNull().default(0),
  rowsRejected: integer("rows_rejected").notNull().default(0),
  validationReport: jsonb("validation_report"),
});

export type SyncRun = typeof syncRuns.$inferSelect;
export type InsertSyncRun = typeof syncRuns.$inferInsert;
export type DataImport = typeof dataImports.$inferSelect;
export type InsertDataImport = typeof dataImports.$inferInsert;
