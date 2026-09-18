import { and, asc, eq } from "drizzle-orm";
import { categories, services, vendors } from "@occasion/db/schema";
import type { CoreContext } from "../context.js";
import { NotFoundError } from "../errors.js";
import { publiclyListable } from "../vendors/transitions.js";

/**
 * What a customer may find.
 *
 * Only the listability rule lives here for now — the discovery screens are a
 * later phase. It is here rather than there because the rule belongs to the
 * vendor queue that this phase built: approving a business is what puts its
 * services in front of customers, and suspending one has to take them away
 * again. A rule written when the search screen is built is a rule that was
 * missing for every phase in between.
 */

export type PublicService = {
  id: string;
  slug: string;
  title: string;
  vendorId: string;
  vendorName: string;
  categoryName: string;
  basePrice: bigint;
  currency: string;
  priceUnit: string;
  bookingMode: string;
  areaLabel: string | null;
};

/**
 * Everything a customer may be shown.
 *
 * One condition today, and it is the vendor's rather than the service's: the
 * business has to be approved. Filtering in the query rather than after it
 * matters — a suspended vendor's rows must not reach the caller at all, because
 * a caller that receives them will eventually forget to drop one.
 *
 * Publication is the second condition and is **not** applied yet, because
 * nothing sets it: `services.published_at` is written by no code path, so a
 * query that required it would return an empty catalogue and the vendor rule
 * below it would never run. Phase 8 owns publishing, and adding
 * `isNotNull(services.publishedAt)` here is that phase's change — along with
 * making the column a timestamp, which it is not.
 */
export async function listPublicServices(
  ctx: CoreContext,
  filter: { categorySlug?: string | undefined } = {},
): Promise<PublicService[]> {
  const conditions = [
    eq(vendors.status, "approved"),
    ...(filter.categorySlug ? [eq(categories.slug, filter.categorySlug)] : []),
  ];

  return ctx.db
    .select({
      id: services.id,
      slug: services.slug,
      title: services.title,
      vendorId: vendors.id,
      vendorName: vendors.name,
      categoryName: categories.name,
      basePrice: services.basePrice,
      currency: services.currency,
      priceUnit: services.priceUnit,
      bookingMode: services.bookingMode,
      areaLabel: services.areaLabel,
    })
    .from(services)
    .innerJoin(vendors, eq(vendors.id, services.vendorId))
    .innerJoin(categories, eq(categories.id, services.categoryId))
    .where(and(...conditions))
    .orderBy(asc(services.title));
}

/**
 * One service, for a public page.
 *
 * `NotFoundError` whether the row is absent or belongs to a vendor who is no
 * longer approved. The two are deliberately the same answer: a suspended
 * business's page must not become a way to learn that the business exists and
 * has been suspended.
 */
export async function getPublicService(
  ctx: CoreContext,
  slug: string,
): Promise<PublicService | undefined> {
  const [row] = await ctx.db
    .select({
      id: services.id,
      slug: services.slug,
      title: services.title,
      vendorId: vendors.id,
      vendorName: vendors.name,
      categoryName: categories.name,
      basePrice: services.basePrice,
      currency: services.currency,
      priceUnit: services.priceUnit,
      bookingMode: services.bookingMode,
      areaLabel: services.areaLabel,
      vendorStatus: vendors.status,
    })
    .from(services)
    .innerJoin(vendors, eq(vendors.id, services.vendorId))
    .innerJoin(categories, eq(categories.id, services.categoryId))
    .where(eq(services.slug, slug))
    .limit(1);

  if (!row) throw new NotFoundError("No such service.");

  const { vendorStatus, ...service } = row;
  if (!publiclyListable(vendorStatus)) {
    throw new NotFoundError("No such service.");
  }

  return service;
}
