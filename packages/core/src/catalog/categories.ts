import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import { categories, services, vendors } from "@occasion/db/schema";
import type { CoreContext } from "../context.js";
import type { Actor } from "../identity/actor.js";

/**
 * The category tiles on the home and results screens.
 *
 * A different function from `reference.listCategories`, which is the
 * administrator's list and calls `requireAdmin` — an anonymous browse read does
 * not belong behind that gate, and widening it would take the whole reference
 * module's "administrative, and `requireAdmin` is the whole story" rule with it.
 *
 * The count is over what is **actually listable**: approved business, published
 * listing. `categories.display_count` is the operator's own editable number and
 * is deliberately not what this returns — a tile reading "12 services" over a
 * category whose only two listings are drafts sends everybody who taps it to an
 * empty page, and nothing on that page explains why.
 */

export type BrowseCategory = {
  id: string;
  slug: string;
  name: string;
  tone: string | null;
  /** Listings a customer could open right now. Zero is an ordinary answer. */
  serviceCount: number;
};

export async function listCategoriesForBrowse(
  ctx: CoreContext,
  _actor: Actor,
): Promise<BrowseCategory[]> {
  // Left joins with both conditions in the `on`, not an inner join with them in
  // a `where`. A category whose only listings are drafts still has to come back
  // — as a tile reading zero — and an inner join would drop it, so the row of
  // tiles would change shape as vendors are approved and suspended.
  //
  // Counting `vendors.id` rather than `services.id` is what makes the number
  // right: it is non-null exactly for the service rows that matched *both*
  // joins, and null for a category with nothing listable under it.
  return ctx.db
    .select({
      id: categories.id,
      slug: categories.slug,
      name: categories.name,
      tone: categories.tone,
      serviceCount: sql<number>`count(${vendors.id})::int`,
    })
    .from(categories)
    .leftJoin(
      services,
      and(eq(services.categoryId, categories.id), isNotNull(services.publishedAt)),
    )
    .leftJoin(vendors, and(eq(vendors.id, services.vendorId), eq(vendors.status, "approved")))
    .groupBy(categories.id, categories.slug, categories.name, categories.tone, categories.sortOrder)
    .orderBy(asc(categories.sortOrder), asc(categories.name));
}
