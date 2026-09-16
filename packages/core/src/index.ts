export {
  createCoreContext,
  CoreContextError,
  type AppTier,
  type CoreConfig,
  type CoreContext,
} from "./context.js";

export type {
  AuthPort,
  AuthUser,
  ClockOverride,
  ClockPort,
  EmailMessage,
  EmailPort,
  StripePort,
} from "./ports.js";

// `createTestCoreContext` is intentionally absent: it lives at
// `@occasion/core/testing` so that pulling fakes into application code is a
// visible import rather than an autocomplete away.
