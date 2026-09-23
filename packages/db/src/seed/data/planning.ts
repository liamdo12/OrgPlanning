import { inArray, sql } from "drizzle-orm";
import type { Db } from "../../client.js";
import * as s from "../../schema/index.js";
import { seedId } from "../ids.js";
import { BLACKOUTS, SERVICE_MEDIA, SERVICES } from "./catalog.js";

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

/**
 * Everything the customer's screens read that earlier passes left empty, in one
 * call so `seed/index.ts` gains a line rather than forty.
 *
 * Keys are table names.
 */
export async function seedCustomerRows(db: Db, _anchorAt: Date): Promise<Record<string, number>> {
  return {
    service_media: await writeServiceMedia(db),
    blackout_dates: await writeBlackoutDates(db),
  };
}
