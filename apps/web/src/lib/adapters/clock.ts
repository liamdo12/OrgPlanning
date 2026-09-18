import type { ClockPort } from "@occasion/core";

/**
 * The clock the served application runs on.
 *
 * Both methods answer the real wall clock, and that is the point rather than an
 * omission. The admin clock override is a stored row that the automations
 * screen reads by name and passes explicitly; it deliberately does not reach
 * this adapter, because a port that could shift `now()` would shift it for
 * every service in the request — pricing a checkout, stamping a revocation,
 * deciding a cooling window — for whoever had set it.
 *
 * `realNow` is kept as a separate name for the timestamps that must never be
 * moved even if that ever changes: a revocation cutoff is compared against a
 * token issue time the auth provider stamped on a clock nothing here can touch.
 */
export function createClock(): ClockPort {
  return {
    now: () => new Date(),
    realNow: () => new Date(),
  };
}
