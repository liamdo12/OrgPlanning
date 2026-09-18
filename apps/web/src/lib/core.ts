import "server-only";

import { createCoreContext, type CoreConfig, type CoreContext } from "@occasion/core";
import { createDb, type Db } from "@occasion/db";
import { getEnv } from "./env";
import { createAuth } from "./adapters/auth";
import { createClock } from "./adapters/clock";
import { createEmail } from "./adapters/email";
import { createStripe } from "./adapters/stripe";

/**
 * Builds the core context that every server action and route handler passes
 * into the domain.
 *
 * This module is the seam: the only code that both reads validated environment
 * variables and constructs adapters. The domain packages see neither.
 */

/**
 * Platform economics. Commission is charged on the pre-tax subtotal and HST
 * follows the vendor as supplier; this only carries the rates.
 */
const COMMISSION_BPS = 1000; // 10%
const HST_BPS = 1300; // 13% Ontario

/**
 * The connection pool is per process, not per request — a pool per request
 * would exhaust Postgres. The *context* is still per request, which is what
 * keeps request-scoped state out of module scope.
 *
 * Two things this needs that a plain module-level `let` does not give it, and
 * both became real the moment routes started querying on every request:
 *
 * **A cache that survives hot reload.** Module scope is re-evaluated on each
 * one, so a `let` opens another pool every time a file is saved, and the old
 * one keeps its connections. Development runs out of them within an afternoon.
 * `globalThis` outlives the module, so the pool does not multiply.
 *
 * **A drain on shutdown.** Without it a rollout severs whatever is in flight —
 * including, now, a webhook mid-transaction.
 */
type Pool = { db: Db; close: () => Promise<void> };

const POOL_KEY = Symbol.for("occasion.web.pool");
const globals = globalThis as typeof globalThis & { [POOL_KEY]?: Pool };

function getDb(): Db {
  const env = getEnv();

  globals[POOL_KEY] ??= openPool(env.DATABASE_URL, env.APP_TIER === "local");
  return globals[POOL_KEY].db;
}

function openPool(connectionString: string, debug: boolean): Pool {
  const pool = createDb({ connectionString, debug });

  // Once per pool, not once per request. `once` rather than `on`, because a
  // listener added per request would leak them and eventually warn.
  process.once("SIGTERM", () => void drain(pool));
  process.once("SIGINT", () => void drain(pool));

  return pool;
}

async function drain(pool: Pool): Promise<void> {
  if (globals[POOL_KEY] === pool) delete globals[POOL_KEY];
  await pool.close().catch(() => {
    // Shutting down either way; a pool that will not close cleanly must not
    // stop the process exiting.
  });
}

function getConfig(): CoreConfig {
  const env = getEnv();
  return {
    appTier: env.APP_TIER,
    allowClockOverride: env.ALLOW_CLOCK_OVERRIDE,
    allowDestructiveSeed: env.ALLOW_DESTRUCTIVE_SEED,
    commissionBps: COMMISSION_BPS,
    hstBps: HST_BPS,
    currency: "CAD",
  };
}

/**
 * Creates the context for the current request.
 *
 * Call this once per server action or route handler and thread the result
 * explicitly. Do not cache it in module scope: a context outliving its request
 * is how request-scoped identity leaks between users.
 */
export function createRequestContext(): CoreContext {
  return createCoreContext({
    db: getDb(),
    auth: createAuth(),
    clock: createClock(),
    email: createEmail(),
    stripe: createStripe(getEnv().STRIPE_SECRET_KEY, getEnv().STRIPE_WEBHOOK_SECRET),
    config: getConfig(),
  });
}

/**
 * Wraps a server action so it receives a fresh context as its first argument.
 *
 * If building the context by hand starts to feel repetitive, reach for this
 * rather than a module singleton — the singleton is the failure mode the
 * context exists to prevent.
 */
export function withCore<TArgs extends unknown[], TResult>(
  action: (ctx: CoreContext, ...args: TArgs) => Promise<TResult>,
): (...args: TArgs) => Promise<TResult> {
  return (...args: TArgs) => action(createRequestContext(), ...args);
}
