import type { ClockOverride, ClockPort } from "@occasion/core";

/**
 * Real-clock adapter.
 *
 * `realNow()` is the wall clock and is never shifted — audit rows and job
 * provenance use it. `now()` is what the domain sees, and is where the admin
 * override will start diverging once it exists, subject to the tier flag and
 * the demo-only row filter.
 */
export function createClock(): ClockPort {
  return {
    now: () => new Date(),
    realNow: () => new Date(),
    override: (): ClockOverride | null => null,
  };
}
