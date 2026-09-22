import { asc, eq, sql } from "drizzle-orm";
import type { Db } from "../client.js";
import * as s from "../schema/index.js";
import { EVENTS } from "./data/activity.js";
import { seedId } from "./ids.js";

/**
 * The planner's structure: one empty slot per category on every seeded event,
 * and each event's own visibility.
 *
 * **Structure only, and no slot states.** Every row here has no service, no
 * order, no quote request and no arrival time, which is an empty slot. Filling
 * them in to match the prototype's four states belongs to the phase that owns
 * the rest of the customer's screens, and the two cannot both insert: the unique
 * `(event_id, category_id)` means a second insert for the same pair conflicts.
 *
 * That conflict is the reason the insert below targets the **primary key**
 * rather than using the bare `.onConflictDoNothing()` this seed otherwise
 * prefers. Untargeted, it would swallow a conflict on the category key as well
 * — so a later pass writing real slot states would lose silently, every time,
 * while the seed went on reporting success. Targeted on `id`, reseeding these
 * rows is a no-op and a collision from anywhere else raises.
 */
export async function seedEventPlan(db: Db): Promise<number> {
  // Per-event visibility, applied here rather than at the insert above so the
  // seed's own function keeps a single call line to this one.
  for (const event of EVENTS) {
    await db
      .update(s.events)
      .set({ visibility: event.visibility })
      .where(eq(s.events.id, seedId(`event:${event.key}`)));
  }

  // Read from the table rather than from the `CATEGORIES` constant, so the seed
  // produces exactly what `createEvent` would: one slot per category that is
  // actually offered, whatever that count is.
  const categories = await db
    .select({ id: s.categories.id, slug: s.categories.slug, sortOrder: s.categories.sortOrder })
    .from(s.categories)
    .where(eq(s.categories.active, true))
    .orderBy(asc(s.categories.sortOrder), asc(s.categories.slug));

  const rows = EVENTS.flatMap((event) =>
    categories.map((category) => ({
      id: seedId(`event_item:${event.key}:${category.slug}`),
      eventId: seedId(`event:${event.key}`),
      categoryId: category.id,
      sortOrder: category.sortOrder,
    })),
  );

  if (rows.length === 0) return 0;

  await db.insert(s.eventItems).values(rows).onConflictDoNothing({ target: s.eventItems.id });

  const [counted] = await db.select({ count: sql<number>`count(*)::int` }).from(s.eventItems);

  return counted?.count ?? rows.length;
}
