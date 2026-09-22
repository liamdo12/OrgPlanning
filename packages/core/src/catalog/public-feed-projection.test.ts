import { describe, expect, it } from "vitest";
import { createDb } from "@occasion/db";
import { guestBand, publicEventFeedQuery, PUBLIC_FEED_SIZE } from "./feed.js";

/**
 * What the signed-out feed publishes about a stranger's event.
 *
 * Column by column, against the query as shipped. This is the assertion the
 * boundary actually rests on: a leak here reads like a feature in a diff, every
 * behavioural test keeps passing, and the first person to notice is whoever the
 * feed named.
 *
 * No database. The query is built and its SQL read — `postgres` opens no socket
 * until a statement is issued — so this runs anywhere, and it asserts the text
 * the server would receive rather than a row somebody happened to seed.
 */

// Never connected to. Building a statement and reading it back touches no
// socket, which is what lets a boundary test run with no database at all.
const pool = createDb({
  connectionString: "postgresql://unused@127.0.0.1:1/unused",
  maxConnections: 1,
});

const built = publicEventFeedQuery(pool.db).toSQL();
const statement = built.sql;

/** The columns the feed is allowed to read off an event. */
const PUBLISHED = ["id", "name", "event_date", "guest_count"] as const;

/**
 * Columns an event carries that the feed must never publish.
 *
 * Written out rather than derived from the schema, because the point is not
 * "the ones we did not select" — it is these specific facts, each of which was
 * decided against for its own reason.
 */
const WITHHELD = {
  owner_user_id: "names the person, which is the whole thing a public feed must not do",
  venue_name: "an address a stranger could turn up at",
  budget: "what somebody is spending is nobody else's business",
  currency: "rides with the budget and means nothing without it",
  start_time: "a date is enough to plan around; an hour is enough to arrive at",
  timezone: "only ever read beside a start time",
  is_demo: "an internal flag, and a tell about which rows are real",
} as const;

describe("the columns the feed selects off an event", () => {
  it.each(PUBLISHED)("publishes %s", (column) => {
    expect(statement).toContain(`"planning_org_events"."${column}"`);
  });

  it("publishes the neighbourhood's name, and nothing else about the place", () => {
    expect(statement).toContain(`"planning_org_neighbourhoods"."name"`);
    // A postal prefix and a pair of coordinates would turn "Liberty Village"
    // into a map pin.
    for (const column of ["postal_prefix", "latitude", "longitude", "search_tags"]) {
      expect(statement, column).not.toContain(`"planning_org_neighbourhoods"."${column}"`);
    }
  });

  it.each(Object.entries(WITHHELD))("withholds %s — %s", (column) => {
    expect(statement).not.toContain(`"planning_org_events"."${column}"`);
  });

  it("names no vendor, no service and no money", () => {
    // The count of booked services is a count. A join that reached a business's
    // name or an order's total would put both one `select` away from the feed.
    for (const forbidden of [
      "planning_org_vendors",
      "planning_org_services",
      "planning_org_payments",
      "planning_org_users",
      "planning_org_transfers",
    ]) {
      expect(statement, forbidden).not.toContain(forbidden);
    }
    expect(statement).not.toContain(`"planning_org_orders"."total"`);
    expect(statement).not.toContain(`"planning_org_orders"."vendor_id"`);
  });

  it("reads the booked count from the lifecycle, not from a listed set of states", () => {
    // Every state that still holds the date, and no state that released it. A
    // cancelled booking counted here tells a stranger a business is committed
    // to a date nobody is.
    expect(built.params).toEqual(
      expect.arrayContaining([
        "pending_payment",
        "confirmed",
        "balance_due",
        "action_required",
        "issue",
        "fulfilled",
        "completed",
      ]),
    );
    expect(built.params).not.toContain("cancelled");
    expect(built.params).not.toContain("refunded");
  });

  it("shows only events whose owner made them public", () => {
    expect(statement).toContain(`"planning_org_events"."visibility"`);
    expect(statement).toContain("'public'");
  });

  it("asks for a page rather than every public event ever planned", () => {
    expect(built.params).toContain(PUBLIC_FEED_SIZE);
  });
});

describe("the guest count, as a band", () => {
  it.each([
    [1, "Up to 25 guests"],
    [25, "Up to 25 guests"],
    [26, "25–50 guests"],
    [60, "50–100 guests"],
    [120, "100–200 guests"],
    [900, "200+ guests"],
  ])("puts %i in %s", (count, label) => {
    expect(guestBand(count)).toBe(label);
  });

  it("says nothing when the owner has not said", () => {
    expect(guestBand(null)).toBeNull();
  });

  it("never returns the number it was given", () => {
    // The band is the boundary. "60 guests" beside a date and a neighbourhood
    // picks out one gathering in the city; "50–100 guests" does not.
    for (const count of [1, 25, 26, 60, 120, 900]) {
      expect(guestBand(count)).not.toBe(String(count));
      expect(guestBand(count)).not.toBe(`${count} guests`);
    }
  });
});
