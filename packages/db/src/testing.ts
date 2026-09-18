/**
 * Database helpers for tests in other packages.
 *
 * Exposed from `@occasion/db/testing` rather than the package root: these
 * rebuild schemas and delete rows, and importing them should be a visible act.
 */
export { migrate } from "./migrate.js";
export { reset, reseedDemo } from "./reset.js";
export { seed, type SeedOptions, type SeedResult } from "./seed/index.js";

/**
 * The seed's money split, for one caller only: the parity test in
 * `packages/core` that holds it against the domain's implementation.
 *
 * The split belongs to the domain and lives in
 * `packages/core/src/payments/money.ts`. This package cannot import that one —
 * `packages/db` may not depend on `packages/core` — so the seed keeps an
 * implementation of the same rule for the rows it writes, and the only thing
 * stopping the two drifting is a test that runs both. Exporting it from the
 * testing entry point is what lets that test exist without making the
 * duplicate reachable from application code.
 */
export { computeMoney, deriveFromTotal, type MoneyBreakdown } from "./seed/money.js";
