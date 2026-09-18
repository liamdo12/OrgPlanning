import { createCoreContext, type CoreConfig, type CoreContext } from "./context.js";
import type { AuthPort, ClockPort, EmailPort, StripePort } from "./ports.js";
import { createStripeFake } from "./testing/stripe-fake.js";

export { createStripeFake, type StripeFake } from "./testing/stripe-fake.js";

/**
 * Test-only context factory.
 *
 * Reachable at `@occasion/core/testing`, deliberately **not** from the package
 * root. Its fakes report every caller as anonymous and every send as delivered,
 * and its defaults permit the clock override — harmless in a test, a silent
 * security downgrade in a request handler. Keeping it off the main entry point
 * means importing it into application code is a visible act.
 *
 * Pass `overrides` to supply only the ports the test under way cares about.
 */
export function createTestCoreContext(overrides: Partial<CoreContext> = {}): CoreContext {
  const fixedNow = new Date("2026-09-15T12:00:00.000Z");

  const config: CoreConfig = {
    appTier: "local",
    allowClockOverride: true,
    allowDestructiveSeed: true,
    // Basis points matching the seeded demo economics.
    commissionBps: 1000,
    hstBps: 1300,
    currency: "CAD",
    ...overrides.config,
  };

  const auth: AuthPort = { getCurrentUser: () => Promise.resolve(null) };

  const clock: ClockPort = {
    now: () => fixedNow,
    realNow: () => fixedNow,
  };

  const stripe: StripePort = createStripeFake();

  const email: EmailPort = {
    send: () => Promise.resolve({ providerMessageId: "test-message" }),
  };

  return createCoreContext({
    db: absentDb(),
    auth,
    stripe,
    email,
    clock,
    ...overrides,
    config,
  });
}

/**
 * Stands in for a database that the test did not supply.
 *
 * No fake query layer is invented here — a test that touches the database
 * passes a real handle as `overrides.db`. Touching this one throws a message
 * that says what to do, instead of a `TypeError` from inside the query builder.
 */
function absentDb(): CoreContext["db"] {
  return new Proxy(
    {},
    {
      get(_target, property) {
        throw new Error(
          `This test context has no database. Pass one as createTestCoreContext({ db }) ` +
            `before using ctx.db.${String(property)}.`,
        );
      },
    },
  ) as CoreContext["db"];
}
