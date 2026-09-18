import postgres from "postgres";
import { createDb } from "@occasion/db";
import { reset } from "@occasion/db/testing";
import { createCoreContext, type CoreContext } from "../src/context.js";
import type { AuthPort, AuthUser } from "../src/ports.js";
import { createStripeFake, type StripeFake } from "../src/testing/stripe-fake.js";

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
export function createDatabaseContext(
  url: string,
  stripe?: StripeFake,
  /**
   * Receives every statement the pool issues.
   *
   * For the one claim about a list screen that its output cannot make: that it
   * runs a fixed number of queries rather than one per row. An N+1 is invisible
   * in an assertion on what comes back, and is the defect a list grows first.
   */
  onQuery?: (query: string) => void,
) {
  const pool = createDb({
    connectionString: url,
    maxConnections: 2,
    ...(onQuery ? { debug: { logQuery: (query: string) => onQuery(query) } } : {}),
  });
  let current: AuthUser | null = null;
  // The domain clock, which an admin override can move. `realNow` below is
  // deliberately not shifted with it, because that is the whole distinction the
  // override has to respect.
  let shiftedNow: Date | null = null;
  // The wall clock, which nothing in the application may move — but a test
  // sometimes has to, because the properties worth asserting include what
  // happens hours later: a retry past the provider's idempotency window, or a
  // grace deadline that has run out.
  let realNowOverride: Date | null = null;

  const auth: AuthPort = { getCurrentUser: () => Promise.resolve(current) };

  const ctx: CoreContext = createCoreContext({
    db: pool.db,
    auth,
    stripe: stripe ?? createStripeFake(),
    email: { send: () => Promise.resolve({ providerMessageId: "test" }) },
    clock: {
      now: () => shiftedNow ?? realNowOverride ?? new Date(),
      realNow: () => realNowOverride ?? new Date(),
      override: () => null,
    },
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
    /** Moves the domain clock, the way an admin demo override does. */
    setDomainNow(instant: Date | null) {
      shiftedNow = instant;
    },
    /**
     * Moves the wall clock, which nothing in the application may do.
     *
     * For assertions about what happens later — a retry past the provider's
     * idempotency window, a grace deadline that has expired. Sleeping for six
     * hours is not an option and neither is lowering the ceiling to make the
     * test pass, because the ceiling is the thing under test.
     */
    setRealNow(instant: Date | null) {
      realNowOverride = instant;
    },
    close: () => pool.close(),
  };
}
