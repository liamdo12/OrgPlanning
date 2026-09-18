import type { Db } from "@occasion/db";
import type { AuthPort, ClockPort, EmailPort, StripePort } from "./ports.js";

/**
 * Which deployment this process is.
 *
 * This is a separate axis from `NODE_ENV` on purpose: the deployed demo runs a
 * production Next build yet must still be able to demo the clock, while a real
 * production deployment of that same build must refuse to.
 */
export type AppTier = "local" | "demo" | "production";

/**
 * Configuration the domain is allowed to see.
 *
 * It is injected, never read from the environment. That is what makes this
 * package portable and testable with no environment at all.
 */
export type CoreConfig = {
  appTier: AppTier;
  /** Whether an admin may set a clock override at all. */
  allowClockOverride: boolean;
  /** Whether the demo data may be torn down and reseeded. */
  allowDestructiveSeed: boolean;
  /** Platform commission, in basis points of the pre-tax subtotal. */
  commissionBps: number;
  /** Ontario HST, in basis points. Follows the vendor as supplier. */
  hstBps: number;
  currency: "CAD";
};

/**
 * Everything a domain service may reach for. Built once per request in
 * `apps/web` and threaded explicitly: every service function takes
 * `(ctx: CoreContext, ...args)` or is produced by a factory bound to one.
 *
 * There are no module-level singletons in this package. That is the whole point
 * of this type — a singleton would reintroduce the hidden global state the
 * context exists to remove.
 */
export type CoreContext = {
  db: Db;
  auth: AuthPort;
  stripe: StripePort;
  email: EmailPort;
  clock: ClockPort;
  config: CoreConfig;
};

/**
 * Anything that can run a query: the pooled handle, or a transaction.
 *
 * A repository function that only ever takes `ctx.db` cannot be composed into a
 * transaction, and the writes this domain makes have to be — approving a vendor
 * changes a status, parks the money already scheduled for them and ends their
 * staff's sessions, and a crash between any two of those leaves the platform
 * paying a business it has just suspended. So the functions that write take an
 * executor, and the service hands them either the pool or the transaction it
 * opened.
 *
 * `Pick` rather than the transaction type itself: naming Drizzle's transaction
 * generic here would drag the driver's type parameters through the domain, and
 * these verbs are all a repository is allowed to use anyway.
 *
 * `execute` is on the list for the handful of things the query builder cannot
 * say — drawing from a sequence, for one. It is a door into raw SQL and should
 * stay a narrow one: a repository reaching for it to express an ordinary query
 * has given up the typing that makes the rest of these safe.
 */
export type DbExecutor = Pick<Db, "select" | "insert" | "update" | "delete" | "execute">;

/** Thrown when a context would violate a tier or money invariant. */
export class CoreContextError extends Error {
  override name = "CoreContextError";
}

/**
 * Validates the configuration and returns a context whose config cannot be
 * changed afterwards.
 *
 * A production deployment must not be able to move time or drop data, whatever
 * its environment happens to say. The returned `config` is frozen so that a
 * later `ctx.config.allowClockOverride = true` throws instead of quietly
 * re-enabling what this function just refused.
 *
 * This is a guard, not a proof: `CoreContext` is a structural type, so a caller
 * can still assemble one by hand and skip this function entirely. Build contexts
 * here, and only here.
 */
export function createCoreContext(deps: CoreContext): CoreContext {
  const { config } = deps;

  if (config.appTier === "production") {
    if (config.allowClockOverride) {
      throw new CoreContextError(
        "allowClockOverride must be false on the production tier. The clock " +
          "override drives real charges and may only run locally or on the demo tier.",
      );
    }
    if (config.allowDestructiveSeed) {
      throw new CoreContextError(
        "allowDestructiveSeed must be false on the production tier. Reseeding " +
          "drops data and must never be reachable in production.",
      );
    }
  }

  assertBps("commissionBps", config.commissionBps);
  assertBps("hstBps", config.hstBps);

  return { ...deps, config: Object.freeze({ ...config }) };
}

/** Basis points are integers in [0, 10000]; a float here would round money wrong. */
function assertBps(field: string, value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > 10_000) {
    throw new CoreContextError(`${field} must be an integer between 0 and 10000, got ${value}.`);
  }
}
