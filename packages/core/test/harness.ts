import postgres from "postgres";
import { createDb } from "@occasion/db";
import { reset } from "@occasion/db/testing";
import { createCoreContext, type CoreContext } from "../src/context.js";
import type { AuthPort, AuthUser } from "../src/ports.js";

/**
 * Shared setup for domain tests that need a real database.
 *
 * The authorization spine cannot be honestly tested against a fake: revocation
 * is a timestamp comparison against a column, roles come from a join, and an
 * audit entry is only real if the row is there afterwards.
 *
 * `TEST_DATABASE_URL` points at a throwaway database. When it is unset these
 * suites skip rather than fail, so `pnpm test` still passes on a machine with
 * no Postgres; CI sets it, which is where the guarantee lives.
 */

export function testDatabaseUrl(): string | undefined {
  return process.env["TEST_DATABASE_URL"];
}

export function ownerSql(url: string) {
  return postgres(url, { max: 1, prepare: false, onnotice: () => {} });
}

export async function resetDatabase(url: string, anchorAt: Date = new Date()) {
  return reset({ connectionString: url, allowDestructive: true, anchorAt });
}

/**
 * A context wired to a real database and a controllable auth adapter.
 *
 * `setUser` is how a test says "this request arrives signed in as": the
 * adapter reports identity only, exactly as the real one does, and everything
 * that governs authority is still read from the database.
 */
export function createDatabaseContext(url: string) {
  const pool = createDb({ connectionString: url, maxConnections: 2 });
  let current: AuthUser | null = null;

  const auth: AuthPort = { getCurrentUser: () => Promise.resolve(current) };

  const ctx: CoreContext = createCoreContext({
    db: pool.db,
    auth,
    stripe: { mode: () => "test" },
    email: { send: () => Promise.resolve({ providerMessageId: "test" }) },
    clock: { now: () => new Date(), realNow: () => new Date(), override: () => null },
    config: {
      appTier: "local",
      allowClockOverride: true,
      allowDestructiveSeed: true,
      commissionBps: 1000,
      hstBps: 1300,
      currency: "CAD",
    },
  });

  return {
    ctx,
    setUser(user: AuthUser | null) {
      current = user;
    },
    close: () => pool.close(),
  };
}
