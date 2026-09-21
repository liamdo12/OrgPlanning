import { describe, expect, it } from "vitest";
import { SORTS, decodeCursor, encodeCursor, type Sort } from "./paging.js";

/**
 * The cursor encoder, on its own.
 *
 * No database: every property here is a property of the string, and the four
 * lists that page are covered by their own suites for what the string is then
 * compared against. What has to hold here is that a cursor round-trips, that a
 * cursor from one list is not a cursor for another, and that anything malformed
 * answers "first page" rather than reaching a query — because the comparands go
 * into `::timestamptz` and `::uuid` casts, where Postgres raises on a bad value
 * instead of matching no rows.
 */

const INSTANT = "2026-09-18 19:19:00.123456+00";
const ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const OTHER_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

const everySort = Object.values(SORTS) as readonly Sort[];

function sampleValue(sort: Sort): string {
  return sort.leading === "timestamptz" ? INSTANT : "Sarah Mensah";
}

describe("sorts", () => {
  it("gives each list an identity of its own", () => {
    const ids = everySort.map((sort) => sort.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps the separator out of every identity", () => {
    // The decoder splits on the first separator to find the sort, so an
    // identity containing one would silently truncate itself.
    for (const sort of everySort) {
      expect(sort.id, sort.id).not.toContain("|");
    }
  });
});

describe("cursors", () => {
  it.each(everySort.map((sort) => [sort.id, sort] as const))("%s round-trips", (_name, sort) => {
    const value = sampleValue(sort);
    expect(decodeCursor(sort, encodeCursor(sort, { value, id: ID }))).toEqual({ value, id: ID });
  });

  it("keeps a timestamp's microseconds", () => {
    // A cursor that went through `Date` would name an instant no row holds, so
    // the `=` half of the tiebreak would never match and every row inside the
    // boundary millisecond would be unreachable at any page.
    const cursor = encodeCursor(SORTS.ordersNewest, { value: INSTANT, id: ID });
    expect(cursor).toContain(".123456+00");
    expect(decodeCursor(SORTS.ordersNewest, cursor)?.value).toBe(INSTANT);
  });

  it("refuses a cursor produced by another sort", () => {
    // Both of these are well-formed. What makes the second one wrong is only
    // which list it came from, and without the identity it would be compared
    // against a `timestamptz` column as a name — which raises.
    const fromNames = encodeCursor(SORTS.usersByName, { value: "Sarah Mensah", id: ID });
    expect(decodeCursor(SORTS.usersByName, fromNames)).toBeDefined();
    expect(decodeCursor(SORTS.ordersNewest, fromNames)).toBeUndefined();
  });

  it("refuses a cursor from the same shape but the opposite direction", () => {
    // Disputes and reports are both oldest-first over a `timestamptz`, so the
    // shapes agree and only the identity separates them. Replayed, one would
    // page a queue from a position in the other.
    const fromDisputes = encodeCursor(SORTS.disputesOldest, { value: INSTANT, id: ID });
    expect(decodeCursor(SORTS.reportsOldest, fromDisputes)).toBeUndefined();
    expect(decodeCursor(SORTS.ordersNewest, fromDisputes)).toBeUndefined();
  });

  it("carries a name containing the separator", () => {
    // Split at the first separator and the last, so everything between them is
    // the value. "Smith | Sons" is a name somebody has.
    const value = "Smith | Sons";
    const cursor = encodeCursor(SORTS.usersByName, { value, id: ID });
    expect(decodeCursor(SORTS.usersByName, cursor)).toEqual({ value, id: ID });
  });

  it("carries an empty name, which is a legal text comparand", () => {
    const cursor = encodeCursor(SORTS.usersByName, { value: "", id: ID });
    expect(decodeCursor(SORTS.usersByName, cursor)).toEqual({ value: "", id: ID });
  });

  it.each([
    ["nothing at all", ""],
    ["no separator", "orders-newest"],
    ["one separator", `orders-newest|${ID}`],
    ["an unknown sort", `orders-by-vendor|${INSTANT}|${ID}`],
    ["a tiebreak that is not a uuid", `orders-newest|${INSTANT}|42`],
    ["a tiebreak with sql in it", `orders-newest|${INSTANT}|' or true--`],
    ["an instant that is not one", `orders-newest|yesterday|${ID}`],
    [
      "an ISO instant, which is not how Postgres renders one",
      `orders-newest|2026-09-18T19:19:00.123Z|${ID}`,
    ],
  ])("falls back to the first page on %s", (_name, cursor) => {
    expect(decodeCursor(SORTS.ordersNewest, cursor)).toBeUndefined();
  });

  it("accepts the renderings Postgres actually produces", () => {
    for (const value of [
      "2026-09-18 19:19:00+00",
      "2026-09-18 19:19:00.1+00",
      "2026-09-18 19:19:00.123456+00",
      "2026-09-18 19:19:00.123456-04:30",
    ]) {
      const cursor = encodeCursor(SORTS.ordersNewest, { value, id: OTHER_ID });
      expect(decodeCursor(SORTS.ordersNewest, cursor), value).toEqual({ value, id: OTHER_ID });
    }
  });
});
