import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../../client.js";
import * as s from "../../schema/index.js";
import { seedId } from "../ids.js";
import { BLACKOUTS, SERVICE_MEDIA, SERVICES, SHORTLIST } from "./catalog.js";
import { ORDERS, QUOTE_REQUEST } from "./activity.js";

/**
 * The rows the customer's own screens read.
 *
 * A writer module rather than another block inside `seed/index.ts`, for the same
 * reason `seedEventPlan` and `seedCapacityBlocks` are ones: everything here is
 * derived from rows the seed has already written, so it reads the tables back
 * rather than keeping a second copy of the demo data to drift from the first.
 *
 * Nothing below invents an instant or a date. Pictures carry none at all, and a
 * closed day is read off the event it falls on.
 */

/**
 * Directions a gradient can run, one per picture so paging is visible.
 *
 * Six of them, which is the largest gallery the seed writes: past that the list
 * wraps and two frames in one gallery would look alike.
 */
const GRADIENT_DIRECTIONS = [
  { x1: "0", y1: "0", x2: "1", y2: "1" },
  { x1: "1", y1: "0", x2: "0", y2: "1" },
  { x1: "0", y1: "0", x2: "1", y2: "0" },
  { x1: "0", y1: "1", x2: "1", y2: "0" },
  { x1: "0", y1: "0", x2: "0", y2: "1" },
  { x1: "1", y1: "1", x2: "0", y2: "0" },
] as const;

/**
 * A picture, as a gradient in the listing's own two colours.
 *
 * The repository has no object storage and no upload path, so there is no file
 * for a `url` to point at. The choice is between a row naming a photograph
 * nobody took and a row naming something real — and the listing card already
 * falls back to a gradient built from these same two colours when it has no
 * pictures at all, so this is that same stand-in travelling through the
 * `service_media` path the screens actually read. Replacing it with photography
 * later is a change to one column.
 *
 * A `data:` URL rather than a remote host: the card renders a plain `img`, so no
 * domain has to be allow-listed for a picture to appear, and nothing here
 * depends on a network the demo may not have.
 */
function gradientPicture(toneStart: string, toneEnd: string, index: number): string {
  const direction = GRADIENT_DIRECTIONS[
    index % GRADIENT_DIRECTIONS.length
  ] as (typeof GRADIENT_DIRECTIONS)[number];

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500">` +
    `<defs><linearGradient id="g" x1="${direction.x1}" y1="${direction.y1}"` +
    ` x2="${direction.x2}" y2="${direction.y2}">` +
    `<stop offset="0" stop-color="${toneStart}"/><stop offset="1" stop-color="${toneEnd}"/>` +
    `</linearGradient></defs><rect width="800" height="500" fill="url(#g)"/></svg>`;

  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

async function writeServiceMedia(db: Db): Promise<number> {
  const tones = new Map(SERVICES.map((service) => [service.key, service.tone] as const));

  const rows = SERVICE_MEDIA.flatMap((listing) => {
    const tone = tones.get(listing.key);
    if (!tone) throw new Error(`Media names service ${listing.key}, which the catalogue does not.`);

    const captions: readonly string[] = "captions" in listing ? listing.captions : [];
    if (captions.length > 0 && captions.length !== listing.pictures) {
      throw new Error(
        `Service ${listing.key} declares ${listing.pictures} pictures and ${captions.length} captions.`,
      );
    }

    return Array.from({ length: listing.pictures }, (_picture, index) => ({
      id: seedId(`service_media:${listing.key}:${index}`),
      serviceId: seedId(`service:${listing.key}`),
      url: gradientPicture(tone[0], tone[1], index),
      // Left null everywhere but the one gallery big enough to browse, so the
      // components' generated fallback has rows behind it too. Both branches
      // ship; a seed that filled every caption would leave one of them asserted
      // by nothing.
      altText: captions[index] ?? null,
      sortOrder: index,
    }));
  });

  if (rows.length === 0) return 0;

  await db
    .insert(s.serviceMedia)
    .values(rows)
    .onConflictDoUpdate({
      target: s.serviceMedia.id,
      set: { url: sql`excluded.url`, altText: sql`excluded.alt_text` },
    });

  return rows.length;
}

/**
 * The days a business is closed, on the dates its customers are planning.
 *
 * The day is **read off the `events` row**, never computed here. The event's own
 * date is already the anchor's offset resolved in the event's timezone, and
 * repeating that arithmetic would be a second copy of the seed's DST handling,
 * free to drift from the first across a March or November boundary.
 */
async function writeBlackoutDates(db: Db): Promise<number> {
  const wanted = BLACKOUTS.map((blackout) => seedId(`event:${blackout.eventKey}`));

  const dates = await db
    .select({ id: s.events.id, day: s.events.eventDate })
    .from(s.events)
    .where(inArray(s.events.id, wanted));

  const dayOf = new Map(dates.map((event) => [event.id, event.day] as const));

  const rows = BLACKOUTS.map((blackout) => {
    const day = dayOf.get(seedId(`event:${blackout.eventKey}`));
    if (!day) throw new Error(`Blackout names event ${blackout.eventKey}, which is not seeded.`);

    return {
      id: seedId(`blackout:${blackout.vendorKey}:${blackout.eventKey}`),
      vendorId: seedId(`vendor:${blackout.vendorKey}`),
      day,
      reason: blackout.reason,
    };
  });

  if (rows.length === 0) return 0;

  // The day moves with the anchor, so reseeding into a database that already
  // holds these rows has to move it rather than leave the business closed on a
  // date no event falls on any more.
  await db
    .insert(s.blackoutDates)
    .values(rows)
    .onConflictDoUpdate({ target: s.blackoutDates.id, set: { day: sql`excluded.day` } });

  return rows.length;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The shortlist, with the instants the screen orders it by. */
async function writeShortlist(db: Db, anchorAt: Date): Promise<number> {
  const rows = SHORTLIST.map((saved) => ({
    id: seedId(`saved:${saved.userKey}:${saved.serviceKey}`),
    userId: seedId(`user:${saved.userKey}`),
    serviceId: seedId(`service:${saved.serviceKey}`),
    createdAt: new Date(anchorAt.getTime() - saved.savedDaysBeforeAnchor * DAY_MS),
  }));

  if (rows.length === 0) return 0;

  await db
    .insert(s.savedServices)
    .values(rows)
    .onConflictDoUpdate({
      target: s.savedServices.id,
      set: { createdAt: sql`excluded.created_at` },
    });

  return rows.length;
}

/**
 * What time each part of the one event the demo opens on turns up.
 *
 * A clock time rather than an instant, because that is what the column is: it
 * is read on the event's own date, in the event's own zone. The first three are
 * the prototype's day schedule — 4:30 PM flowers, 5:00 PM photography, 6:30 PM
 * catering (lines 2406–2409); the install goes in before the guests, two hours
 * ahead of the event's own start time.
 *
 * Only this event has them. A schedule on every seeded event would leave the
 * "nothing scheduled yet" state of the panel with no event to show it on.
 */
const ARRIVALS: Record<string, string> = {
  "sarahs-30th:decorations": "15:00",
  "sarahs-30th:flowers": "16:30",
  "sarahs-30th:photography": "17:00",
  "sarahs-30th:catering": "18:30",
};

type PlannerSlot = {
  eventKey: string;
  categorySlug: string;
  serviceKey: string | null;
  packageName: string | null;
  quantity: number;
  orderReference: string | null;
  quoteRequestKey: string | null;
};

/**
 * The two slots no order accounts for.
 *
 * **In plan** is a service chosen and not yet bought, so it cannot be a slot an
 * order already names — the planner reads an order's own state for that, and a
 * slot holding both would be drawn Booked with its price counted twice, once
 * from the order and once from the line.
 *
 * **Quotes** is the open catering request, on the category it was raised for,
 * with no service: the customer is still comparing. It carries an arrival time
 * all the same, which is the case the day schedule has to handle — a time the
 * event needs something to happen at, before anyone knows who is doing it.
 */
const UNBOUGHT_SLOTS: readonly PlannerSlot[] = [
  {
    eventKey: "sarahs-30th",
    categorySlug: "decorations",
    serviceKey: "d1",
    packageName: "Standard install",
    quantity: 1,
    orderReference: null,
    quoteRequestKey: null,
  },
  {
    eventKey: "sarahs-30th",
    categorySlug: "catering",
    serviceKey: null,
    packageName: null,
    quantity: 1,
    orderReference: null,
    quoteRequestKey: QUOTE_REQUEST.key,
  },
];

/**
 * Every slot this pass fills: one per seeded booking, plus the two above.
 *
 * Derived from `ORDERS` rather than written out again. A booking the planner
 * does not name is a booking the customer cannot find from the event it was
 * made for — the screen the whole spine is built around — and a second copy of
 * the order list is a second thing to keep in step with the first.
 */
function plannerSlots(): PlannerSlot[] {
  const categoryOf = new Map(SERVICES.map((service) => [service.key, service.categorySlug]));

  const bought = ORDERS.map((order): PlannerSlot => {
    const categorySlug = categoryOf.get(order.serviceKey);
    if (!categorySlug) {
      throw new Error(
        `Order ${order.reference} names service ${order.serviceKey}, which is not seeded.`,
      );
    }

    return {
      eventKey: order.eventKey,
      categorySlug,
      serviceKey: order.serviceKey,
      packageName: order.packageName,
      quantity: order.quantity,
      orderReference: order.reference,
      quoteRequestKey: null,
    };
  });

  return [...bought, ...UNBOUGHT_SLOTS];
}

/**
 * The prototype's slot states, written onto the slots that already exist.
 *
 * **An update, never an insert.** One slot per category per event is a unique
 * key, and the pass that owns the rows' existence has already written all of
 * them; a second insert for the same pair is refused by the database rather
 * than merged. So this pass owns their state and nothing else, and a slot it
 * cannot find is an error rather than a row quietly not written — which is the
 * failure that would otherwise show up as a demo missing a booking, with a seed
 * that reported success.
 *
 * No state is stored. What the screen draws is derived from the order's own
 * state and from what the slot still holds: a cancelled booking's slot falls
 * back to the service it named, which is why nothing here has to clear
 * `order_id` when an order ends.
 */
async function fillEventSlots(db: Db): Promise<number> {
  const categories = await db
    .select({ id: s.categories.id, slug: s.categories.slug })
    .from(s.categories);
  const categoryId = new Map(categories.map((category) => [category.slug, category.id] as const));

  let filled = 0;

  for (const slot of plannerSlots()) {
    const category = categoryId.get(slot.categorySlug);
    if (!category) throw new Error(`No category ${slot.categorySlug} for the planner to fill.`);

    const updated = await db
      .update(s.eventItems)
      .set({
        serviceId: slot.serviceKey ? seedId(`service:${slot.serviceKey}`) : null,
        servicePackageId:
          slot.serviceKey && slot.packageName
            ? seedId(`package:${slot.serviceKey}:${slot.packageName}`)
            : null,
        quantity: slot.quantity,
        arrivalTime: ARRIVALS[`${slot.eventKey}:${slot.categorySlug}`] ?? null,
        orderId: slot.orderReference ? seedId(`order:${slot.orderReference}`) : null,
        quoteRequestId: slot.quoteRequestKey
          ? seedId(`quote_request:${slot.quoteRequestKey}`)
          : null,
      })
      .where(
        and(
          eq(s.eventItems.eventId, seedId(`event:${slot.eventKey}`)),
          eq(s.eventItems.categoryId, category),
        ),
      )
      .returning({ id: s.eventItems.id });

    if (updated.length !== 1) {
      throw new Error(
        `The planner has no ${slot.categorySlug} slot on ${slot.eventKey} to fill; it matched ${updated.length}.`,
      );
    }

    filled += updated.length;
  }

  return filled;
}

/**
 * Everything the customer's screens read that earlier passes left empty, in one
 * call so `seed/index.ts` gains a line rather than forty.
 *
 * Keys are table names, except `event_items_filled`: the slots are updated and
 * none is inserted, so counting them under `event_items` would overwrite a
 * number that is about how many slots exist.
 */
export async function seedCustomerRows(db: Db, anchorAt: Date): Promise<Record<string, number>> {
  return {
    service_media: await writeServiceMedia(db),
    blackout_dates: await writeBlackoutDates(db),
    saved_services: await writeShortlist(db, anchorAt),
    event_items_filled: await fillEventSlots(db),
  };
}
