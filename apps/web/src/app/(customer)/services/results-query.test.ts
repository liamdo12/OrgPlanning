import { describe, expect, it } from "vitest";
import { SEARCH_FILTER_FIELDS } from "@occasion/core";
import {
  PRICE_MAX_CENTS,
  hasNarrowingFilters,
  nextPageHref,
  readResultsQuery,
  sortInForce,
  withoutFilters,
} from "./results-query.js";

/**
 * What the results URL is allowed to say.
 *
 * The reader is the whole contract between the address bar and the catalogue
 * query, so it is tested as one: what it accepts, what it refuses and names,
 * and what it never offers at all.
 */

/** The browsable categories are a domain read; these are the seeded slugs. */
const CATEGORIES = ["flowers", "catering", "cakes", "photography"];

const read = (query: string) => readResultsQuery(new URLSearchParams(query), CATEGORIES);

describe("reading the results URL", () => {
  it("applies nothing when nothing is asked for", () => {
    const { filter, dropped } = read("");

    expect(filter).toEqual({});
    expect(dropped).toEqual([]);
    expect(sortInForce(filter)).toBe("recommended");
  });

  it("carries a category, a place, a mode, a cap and a rating into the query", () => {
    const { filter, dropped } = read(
      "cat=flowers&where=liberty-village&mode=quote&max=25000&rating=4.8",
    );

    expect(filter).toEqual({
      categorySlug: "flowers",
      neighbourhoodSlug: "liberty-village",
      bookingMode: "quote",
      maxPrice: 25_000n,
      minRating: 4.8,
    });
    expect(dropped).toEqual([]);
  });

  it("keeps a price cap as cents, never as a number the query would widen", () => {
    // The column is `bigint`, and a cap that arrived as a `number` would be
    // compared against money by a coercion nobody wrote.
    expect(read("max=50000").filter.maxPrice).toBe(50_000n);
  });

  it("drops a category nobody offers, and says so", () => {
    const { filter, dropped } = read("cat=yachts");

    expect(filter.categorySlug).toBeUndefined();
    expect(dropped).toEqual(["category"]);
  });

  it.each([
    ["mode=maybe", "booking mode"],
    ["max=-5", "maximum price"],
    ["max=abc", "maximum price"],
    [`max=${PRICE_MAX_CENTS + 1}`, "maximum price"],
    ["rating=1", "rating"],
    ["sort=cheapest", "sort order"],
  ])("refuses %s and names the control", (query, named) => {
    const { dropped } = read(query);

    expect(dropped).toEqual([named]);
  });

  it("refuses a cap that is digits with something after them", () => {
    // `Number.parseInt` would read this as 50000 and compare it against money.
    expect(read("max=50000 or 1=1").dropped).toEqual(["maximum price"]);
  });

  it("passes a cursor through without judging it, and never calls it dropped", () => {
    // The domain's decoder answers the first page for anything it does not
    // recognise. Naming it would tell somebody a control was disregarded that
    // they never touched.
    const { filter, dropped } = read("cursor=services-rating|4.8|not-a-uuid");

    expect(filter.cursor).toBe("services-rating|4.8|not-a-uuid");
    expect(dropped).toEqual([]);
  });

  it("offers no way to ask which services are free on a date", () => {
    // The same claim the domain's filter type makes, at the other end of the
    // wire: the anonymous catalogue has no availability filter, because the
    // signed-out feed already publishes a stranger's date and neighbourhood.
    const { filter } = read("when=2027-03-20&flex=1&free=2027-03-20");

    expect(Object.keys(filter)).toEqual([]);
    expect(SEARCH_FILTER_FIELDS.some((field) => /date|when|day|free|avail/i.test(field))).toBe(
      false,
    );
  });

  it("knows which narrowings are the panel's, so the right empty state shows", () => {
    // A category with nothing in it is not a search that narrowed too far.
    expect(hasNarrowingFilters(read("cat=flowers").filter)).toBe(false);
    expect(hasNarrowingFilters(read("where=midtown").filter)).toBe(false);
    expect(hasNarrowingFilters(read("mode=quote").filter)).toBe(true);
    expect(hasNarrowingFilters(read("max=10000").filter)).toBe(true);
    expect(hasNarrowingFilters(read("rating=4.8").filter)).toBe(true);
  });
});

describe("the next page's address", () => {
  it("carries every narrowing, because a cursor only means anything against one", () => {
    const href = nextPageHref(
      new URLSearchParams("cat=flowers&mode=quote&sort=rating&max=25000"),
      "services-rating|4.8|11111111-1111-1111-1111-111111111111",
    );
    const next = new URL(href, "https://occasion.test");

    expect(next.pathname).toBe("/services");
    expect(next.searchParams.get("cat")).toBe("flowers");
    expect(next.searchParams.get("mode")).toBe("quote");
    expect(next.searchParams.get("sort")).toBe("rating");
    expect(next.searchParams.get("max")).toBe("25000");
    expect(next.searchParams.get("cursor")).toBe(
      "services-rating|4.8|11111111-1111-1111-1111-111111111111",
    );
  });

  it("replaces the cursor rather than appending a second one", () => {
    const href = nextPageHref(new URLSearchParams("cursor=first"), "second");

    expect(new URL(href, "https://occasion.test").searchParams.getAll("cursor")).toEqual([
      "second",
    ]);
  });

  it("reads back through the same reader, so a page walks the list it came from", () => {
    // The round trip is the property: a next-page link whose filters the
    // reader then drops would page through a different list every time.
    const cursor = "services-price-lowest|9500|11111111-1111-1111-1111-111111111111";
    const first = read("cat=flowers&mode=quote&sort=price_low_to_high&max=25000");
    const href = nextPageHref(
      new URLSearchParams("cat=flowers&mode=quote&sort=price_low_to_high&max=25000"),
      cursor,
    );
    const second = readResultsQuery(
      new URL(href, "https://occasion.test").searchParams,
      CATEGORIES,
    );

    expect(second.filter).toEqual({ ...first.filter, cursor });
    expect(second.dropped).toEqual([]);
  });
});

describe("clearing the filters", () => {
  it("keeps the category and the place, and drops the panel's three", () => {
    const href = withoutFilters(
      new URLSearchParams("cat=flowers&where=midtown&mode=quote&max=25000&rating=4.8&cursor=x"),
    );
    const cleared = new URL(href, "https://occasion.test");

    expect(cleared.searchParams.get("cat")).toBe("flowers");
    expect(cleared.searchParams.get("where")).toBe("midtown");
    expect(cleared.searchParams.get("mode")).toBeNull();
    expect(cleared.searchParams.get("max")).toBeNull();
    expect(cleared.searchParams.get("rating")).toBeNull();
    // The cursor names a row in the list that has just been widened.
    expect(cleared.searchParams.get("cursor")).toBeNull();
  });

  it("is the bare path when there was nothing else to keep", () => {
    expect(withoutFilters(new URLSearchParams("mode=quote"))).toBe("/services");
  });
});
