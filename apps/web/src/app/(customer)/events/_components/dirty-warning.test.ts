import { describe, expect, it } from "vitest";
import { dirtyWarning } from "./dirty-warning";

/**
 * The band above Save.
 *
 * Worth a test rather than a glance because it is copy that makes a promise:
 * the date half has to describe a save that is about to be refused, and the
 * guest half has to describe one that is about to succeed. Getting them the
 * wrong way round is invisible in a diff and obvious to the person reading it.
 */

const LOADED = { eventDate: "2027-03-20", guestCount: 60 };

describe("the warning above Save", () => {
  it("says nothing while nothing has changed", () => {
    expect(
      dirtyWarning({
        loaded: LOADED,
        current: { ...LOADED },
        bookedCategories: ["Photography"],
      }),
    ).toBeUndefined();
  });

  it("warns about a date change, naming what holds the date", () => {
    const warning = dirtyWarning({
      loaded: LOADED,
      current: { ...LOADED, eventDate: "2027-04-10" },
      bookedCategories: ["Photography", "Flowers"],
    });

    expect(warning?.kind).toBe("date");
    expect(warning?.text).toContain("Photography and Flowers are booked");
    // The refusal's own wording, so the warning and the refusal describe one
    // rule rather than two.
    expect(warning?.text).toContain("while a booking is live");
  });

  it("stays quiet about a date nobody has booked against", () => {
    // The band is danger-coloured. Showing it over an event with nothing
    // booked is how people learn to dismiss it.
    expect(
      dirtyWarning({
        loaded: LOADED,
        current: { ...LOADED, eventDate: "2027-04-10" },
        bookedCategories: [],
      }),
    ).toBeUndefined();
  });

  it("warns about a guest change, from and to", () => {
    const warning = dirtyWarning({
      loaded: LOADED,
      current: { ...LOADED, guestCount: 80 },
      bookedCategories: [],
    });

    expect(warning?.kind).toBe("guests");
    expect(warning?.text).toContain("from 60 to 80");
    // Not "vendors will be asked to re-quote": nothing asks them.
    expect(warning?.text).toContain("nothing re-prices itself");
  });

  it("handles an event that had no guest count at all", () => {
    const warning = dirtyWarning({
      loaded: { eventDate: "2027-03-20", guestCount: null },
      current: { eventDate: "2027-03-20", guestCount: 40 },
      bookedCategories: [],
    });

    expect(warning?.kind).toBe("guests");
    expect(warning?.text).toContain("set to 40");
  });

  it("leads with the date when both changed, because that is the one refused", () => {
    const warning = dirtyWarning({
      loaded: LOADED,
      current: { eventDate: "2027-04-10", guestCount: 80 },
      bookedCategories: ["Photography"],
    });

    expect(warning?.kind).toBe("date");
  });

  it("falls back to the guest warning when no booking blocks the date", () => {
    const warning = dirtyWarning({
      loaded: LOADED,
      current: { eventDate: "2027-04-10", guestCount: 80 },
      bookedCategories: [],
    });

    expect(warning?.kind).toBe("guests");
  });
});
