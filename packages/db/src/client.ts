import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";

/**
 * Options for opening a database connection.
 *
 * The connection string is an argument, never an environment read: `apps/web`
 * validates it and hands it down through the core context. That is what lets a
 * domain service be unit-tested with a fake context and no environment.
 */
export type DbOptions = {
  /** Postgres connection string for the least-privileged application role. */
  connectionString: string;
  /** Upper bound on pooled connections. */
  maxConnections?: number;
  /** Emit generated SQL. Local debugging only. */
  debug?: boolean;
};

export type Db = ReturnType<typeof createDb>["db"];

/**
 * Opens a pooled connection and returns the Drizzle handle plus a closer.
 *
 * Callers own the lifecycle: one pool per process, and `close()` on shutdown or
 * in test teardown. postgres.js opens no socket until the first query, so
 * creating this is cheap; leaking pools is not.
 */
export function createDb(options: DbOptions) {
  const sql = postgres(options.connectionString, {
    max: options.maxConnections ?? 10,
    // Prepared statements are disabled because connections may pass through a
    // transaction-mode pooler, which cannot support them.
    prepare: false,
  });

  const db = drizzle(sql, { schema, logger: options.debug ?? false });

  return {
    db,
    /** Drains the pool. Call on shutdown and in test teardown. */
    close: async () => {
      await sql.end({ timeout: 5 });
    },
  };
}
