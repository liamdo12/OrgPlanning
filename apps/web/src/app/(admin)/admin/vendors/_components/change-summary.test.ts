import { describe, expect, it } from "vitest";
import type { StatusChange } from "@occasion/core";
import { summarise } from "./change-summary";

/**
 * The sentence an administrator is left with.
 *
 * Worth asserting because it is the only place the consequences of a decision
 * are reported back: the payouts a suspension stopped and the sessions it
 * ended are not visible anywhere else on the screen, and a message that
 * silently dropped them would make a suspension look like a badge change.
 */

function change(overrides: Partial<StatusChange> = {}): StatusChange {
  return {
    vendorId: "vendor-1",
    name: "Bloom & Co",
    from: "approved",
    to: "suspended",
    heldTransfers: 0,
    heldJobs: 0,
    releasedTransfers: 0,
    releasedJobs: 0,
    endedSessions: 0,
    ...overrides,
  };
}

describe("what a status change is reported as", () => {
  it("says only what happened when nothing else moved", () => {
    expect(summarise(change({ to: "approved", from: "pending", name: "Kimchi Kart" }))).toBe(
      "Kimchi Kart is now approved.",
    );
  });

  it("counts held payouts across both the transfers and the queued jobs", () => {
    // Two places, one number: an administrator does not care which table the
    // money was sitting in, only that it is no longer going anywhere.
    expect(summarise(change({ heldTransfers: 1, heldJobs: 2 }))).toContain(
      "3 queued payouts are on hold.",
    );
  });

  it("reads correctly for one of each", () => {
    const one = summarise(change({ heldTransfers: 1, endedSessions: 1 }));
    expect(one).toContain("1 queued payout is on hold.");
    expect(one).toContain("1 staff session ended.");
  });

  it("reports what a reinstatement released", () => {
    const released = summarise(
      change({ to: "approved", from: "suspended", releasedTransfers: 2, releasedJobs: 1 }),
    );
    expect(released).toBe("Bloom & Co is now approved. 3 held payouts released.");
  });

  it("never claims sessions ended when none did", () => {
    // A business with no staff attached: saying "0 sessions ended" would be
    // noise, and saying nothing is the truth.
    expect(summarise(change({ heldJobs: 1 }))).not.toMatch(/session/);
  });
});
