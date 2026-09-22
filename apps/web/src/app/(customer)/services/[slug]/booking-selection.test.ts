import { describe, expect, it } from "vitest";
import {
  MAX_QUANTITY,
  arrivalOptions,
  readBookingSelection,
  selectionHref,
} from "./booking-selection.js";

/**
 * What the booking card may be asked for.
 *
 * Everything here reaches `quoteCheckout` and then `addItemToPlan`, so the
 * reader's job is to make sure only things this listing offers get that far: a
 * package id belonging to another service prices a tier nobody is selling, and
 * a quantity that is not a whole number is refused by the domain with an error
 * where a default would have done.
 */

const PACKAGES = ["pkg-standard", "pkg-deluxe"];
const ARRIVALS = arrivalOptions("17:00");

const read = (query: string) =>
  readBookingSelection(new URLSearchParams(query), {
    packageIds: PACKAGES,
    arrivals: ARRIVALS,
  });

describe("the arrival times an event can offer", () => {
  it("puts three half-hours around the event's own start", () => {
    expect(arrivalOptions("17:00")).toEqual([
      { value: "16:30", label: "4:30 PM" },
      { value: "17:00", label: "5:00 PM" },
      { value: "17:30", label: "5:30 PM" },
    ]);
  });

  it("offers none when the event has no start time", () => {
    // Three invented times would be a promise made on a vendor's behalf.
    expect(arrivalOptions(null)).toEqual([]);
    expect(arrivalOptions("")).toEqual([]);
  });

  it("reads a seconds-bearing time, which is how the column comes back", () => {
    expect(arrivalOptions("09:00:00").map((option) => option.label)).toEqual([
      "8:30 AM",
      "9:00 AM",
      "9:30 AM",
    ]);
  });

  it("does not run off either end of the day", () => {
    expect(arrivalOptions("00:00").map((option) => option.value)).toEqual(["00:00", "00:30"]);
    expect(arrivalOptions("23:45").map((option) => option.value)).toEqual(["23:15", "23:45"]);
  });

  it("writes noon and midnight as twelve, not as zero", () => {
    expect(arrivalOptions("12:00")[1]?.label).toBe("12:00 PM");
    expect(arrivalOptions("00:30")[1]?.label).toBe("12:30 AM");
  });
});

describe("reading the booking selection", () => {
  it("defaults to the first tier, one of them, and the event's own hour", () => {
    expect(read("")).toEqual({
      servicePackageId: "pkg-standard",
      quantity: 1,
      arrivalTime: "17:00",
    });
  });

  it("takes a tier this listing actually sells", () => {
    expect(read("pkg=pkg-deluxe").servicePackageId).toBe("pkg-deluxe");
  });

  it("refuses a tier from another listing rather than pricing it", () => {
    expect(read("pkg=pkg-from-another-service").servicePackageId).toBe("pkg-standard");
  });

  it("has no tier at all when the listing sells none", () => {
    // Then the base price is what it is sold at, and the picker is not drawn.
    const selection = readBookingSelection(new URLSearchParams("pkg=anything"), {
      packageIds: [],
      arrivals: ARRIVALS,
    });

    expect(selection.servicePackageId).toBeNull();
  });

  it("takes a whole quantity inside the bounds", () => {
    expect(read("qty=3").quantity).toBe(3);
    expect(read(`qty=${MAX_QUANTITY}`).quantity).toBe(MAX_QUANTITY);
  });

  it.each(["qty=0", "qty=-2", "qty=1.5", "qty=lots", `qty=${MAX_QUANTITY + 1}`, "qty="])(
    "falls back to one for %s",
    (query) => {
      expect(read(query).quantity).toBe(1);
    },
  );

  it("takes an arrival time the event offers, and only one", () => {
    expect(read("arrive=16:30").arrivalTime).toBe("16:30");
    expect(read("arrive=03:00").arrivalTime).toBe("17:00");
  });

  it("has no arrival time when the event has no hour to offer one against", () => {
    const selection = readBookingSelection(new URLSearchParams("arrive=17:00"), {
      packageIds: PACKAGES,
      arrivals: [],
    });

    expect(selection.arrivalTime).toBeNull();
  });
});

describe("changing one part of the selection", () => {
  it("keeps the rest of the address", () => {
    const href = selectionHref(
      "bridal-and-table-bouquets",
      new URLSearchParams("pkg=pkg-deluxe&qty=2&cat=flowers"),
      { qty: "3" },
    );
    const next = new URL(href, "https://occasion.test");

    expect(next.pathname).toBe("/services/bridal-and-table-bouquets");
    expect(next.searchParams.get("pkg")).toBe("pkg-deluxe");
    expect(next.searchParams.get("qty")).toBe("3");
    // The search the visitor arrived with is still theirs on the way back.
    expect(next.searchParams.get("cat")).toBe("flowers");
  });

  it("is the bare listing when there is nothing to carry", () => {
    expect(selectionHref("dj-and-lighting", new URLSearchParams(), {})).toBe(
      "/services/dj-and-lighting",
    );
  });
});
