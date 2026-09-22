import { describe, expect, it } from "vitest";
import {
  DEFAULT_SERVICE_SORT,
  SEARCH_FILTER_FIELDS,
  SERVICE_SORTS,
  type ServiceSort,
} from "./search.js";

/**
 * The two properties of the results query that hold without a database.
 *
 * What the query returns is asserted against real rows in
 * `catalog-discovery.test.ts`. What is asserted here is the shape of the
 * question it can be asked, and the identity of the three orders it can be
 * asked in — both of which are decisions rather than behaviour, and both of
 * which a passing behavioural test would happily ratify after somebody changed
 * them.
 */

describe("what the anonymous catalogue can be narrowed by", () => {
  /**
   * Names that would mean "on this date", in the spellings a filter grows.
   *
   * A pattern rather than an exact list: the field that reopens this will be
   * called whatever the screen that wants it calls its input.
   */
  const DATE_SHAPED = /date|day|when|available|free|from|until|before|after|between/i;

  it("offers no way to ask which services are free on a date", () => {
    // Not a style rule. The signed-out feed publishes a stranger's event date
    // and neighbourhood; answering "free on this date" anonymously, from the
    // same capacity rows a booking writes, lets two queries be differenced into
    // exactly which businesses that stranger booked — with the feed's own
    // "6 services booked" as the checksum. The question is answerable on one
    // service's own page, about one business the asker has already named.
    const dateShaped = SEARCH_FILTER_FIELDS.filter((field) => DATE_SHAPED.test(field));

    expect(dateShaped).toEqual([]);
  });

  it("knows its own fields", () => {
    // An empty list would satisfy the case above while proving nothing, which
    // is what a registry that stopped being tied to the type looks like.
    expect(SEARCH_FILTER_FIELDS).toEqual([
      "categorySlug",
      "neighbourhoodSlug",
      "bookingMode",
      "maxPrice",
      "minRating",
      "sort",
      "cursor",
    ]);
  });

  it("names places and categories by slug, never by id", () => {
    // A slug is what the public URL already carries, so nothing here obliges a
    // caller to have been told an id — and no entry in the authorization matrix
    // is owed for a filter that names none.
    const idShaped = SEARCH_FILTER_FIELDS.filter((field) =>
      /^(id|ids)$|[a-z0-9](Id|Ids)$/.test(field),
    );

    expect(idShaped).toEqual([]);
  });
});

describe("the three orders the results screen offers", () => {
  const plans = Object.entries(SERVICE_SORTS) as ReadonlyArray<
    [ServiceSort, (typeof SERVICE_SORTS)[ServiceSort]]
  >;

  it("gives each one a cursor identity of its own", () => {
    // Three labels over one query would make two of the cursors interchangeable
    // and the third sort a lie. The identity is what refuses a cursor replayed
    // from another list, so sharing one would page the wrong order silently.
    const ids = plans.map(([, plan]) => plan.sort.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("leads on a number in every one, so a hand-edited cursor is validated", () => {
    for (const [name, plan] of plans) {
      expect(plan.sort.leading, name).toBe("numeric");
    }
  });

  it("names a distinct index for each", () => {
    // An index nothing asserts is one that silently stops being used. The names
    // are what `performance.test.ts` runs `explain` against.
    const indexes = plans.map(([, plan]) => plan.index);
    expect(new Set(indexes).size).toBe(indexes.length);
  });

  it("defaults to an order that exists", () => {
    expect(SERVICE_SORTS[DEFAULT_SERVICE_SORT]).toBeDefined();
  });
});
