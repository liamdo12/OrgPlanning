import { asc, eq, inArray, sql } from "drizzle-orm";
import { events, neighbourhoods, orderItems, orders } from "@occasion/db/schema";
import type { CoreContext, DbExecutor } from "../context.js";
import type { Actor } from "../identity/actor.js";
import { ORDER_STATES, releasesCapacity } from "../ordering/transitions.js";

/**
 * The signed-out feed of what Toronto is planning.
 *
 * Five things about somebody else's event and nothing more: its name, its date,
 * the neighbourhood, a band for the guest count, and how many services have
 * been booked for it. Never the owner, never the venue address, never which
 * businesses were booked, and never any money.
 *
 * The column list is the whole boundary, so it is asserted column by column in
 * `public-feed-projection.test.ts` rather than reviewed by eye. A leak added to
 * this projection looks exactly like a feature in a diff, and every behavioural
 * test would keep passing.
 *
 * The guest count is published as a **band**. An exact head count is a stronger
 * identifier than it looks beside a date and a neighbourhood — three fields that
 * together pick out one gathering in a city — and the screen draws "50–100
 * guests" perfectly well.
 *
 * The prototype also shows a kind ("Birthday", "Wedding"). Events carry no such
 * column, so it is absent rather than guessed at from the name.
 */

/** Bands, in the order they are tried. The last one has no ceiling. */
const GUEST_BANDS: ReadonlyArray<{ upTo: number | null; label: string }> = [
  { upTo: 25, label: "Up to 25 guests" },
  { upTo: 50, label: "25–50 guests" },
  { upTo: 100, label: "50–100 guests" },
  { upTo: 200, label: "100–200 guests" },
  { upTo: null, label: "200+ guests" },
];

export function guestBand(guestCount: number | null): string | null {
  if (guestCount === null) return null;

  const band = GUEST_BANDS.find(
    (candidate) => candidate.upTo === null || guestCount <= candidate.upTo,
  );

  return band?.label ?? null;
}

export type PublicEvent = {
  id: string;
  name: string;
  /** `YYYY-MM-DD`, in the event's own zone. */
  eventDate: string;
  neighbourhood: string | null;
  /** A band, never a head count. Null when the owner has not said. */
  guestBand: string | null;
  bookedServices: number;
};

/**
 * Order states whose booking still stands.
 *
 * Derived from the lifecycle rather than listed: a cancelled booking's slot is
 * released, so counting it would tell a stranger a business is committed to a
 * date nobody is. A tenth state added later is classified the moment it exists,
 * which a hand-written list would not be.
 */
const LIVE_STATES = ORDER_STATES.filter((state) => !releasesCapacity(state));

/**
 * Which events the feed may show.
 *
 * Compared as text rather than against the enum member, because `public` is not
 * yet a value of `event_visibility` and the typed comparison does not compile
 * until the migration adding it lands. The cast is exact — Postgres renders an
 * enum as its own label — so this selects the same rows the typed predicate
 * will, both before the value exists (none) and after.
 */
const IS_PUBLIC = sql`${events.visibility}::text = 'public'`;

/** One page of the feed. The prototype draws four of these; the screen slices. */
export const PUBLIC_FEED_SIZE = 12;

/**
 * The feed's query, exactly as `listPublicEventFeed` runs it.
 *
 * Exported so the projection test can read the columns off the shipped query
 * rather than off a copy. A boundary asserted against a second expression of
 * itself is a boundary asserted against nothing.
 */
export function publicEventFeedQuery(db: DbExecutor) {
  return (
    db
      .select({
        id: events.id,
        name: events.name,
        eventDate: events.eventDate,
        neighbourhood: neighbourhoods.name,
        guestCount: events.guestCount,
        // A count, not a list. Which businesses were booked is exactly what this
        // feed promises never to expose, and a subquery returning their names
        // would put them one `select` away from doing so.
        bookedServices: sql<number>`(
        select count(*)::int
        from ${orderItems}
        join ${orders} on ${orders.id} = ${orderItems.orderId}
        where ${orders.eventId} = ${events.id}
          and ${inArray(orders.state, LIVE_STATES)}
      )`,
      })
      .from(events)
      .leftJoin(neighbourhoods, eq(neighbourhoods.id, events.neighbourhoodId))
      .where(IS_PUBLIC)
      // Soonest first: a feed of what is being planned is about what is coming.
      .orderBy(asc(events.eventDate), asc(events.id))
      .limit(PUBLIC_FEED_SIZE)
  );
}

export async function listPublicEventFeed(ctx: CoreContext, _actor: Actor): Promise<PublicEvent[]> {
  const rows = await publicEventFeedQuery(ctx.db);

  // The band is computed here rather than in SQL so the boundary stays one list
  // of columns somebody can read, and the exact count never leaves this module
  // as a field something downstream could serialise by accident.
  return rows.map(({ guestCount, ...event }) => ({
    ...event,
    guestBand: guestBand(guestCount),
  }));
}
