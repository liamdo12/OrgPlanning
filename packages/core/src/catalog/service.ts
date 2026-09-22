import { and, asc, eq, isNotNull } from "drizzle-orm";
import { categories, services, vendors } from "@occasion/db/schema";
import type { CoreContext } from "../context.js";
import { NotFoundError } from "../errors.js";
import type { Actor } from "../identity/actor.js";
import { publiclyListable } from "../vendors/transitions.js";

/**
 * What a customer may find.
 *
 * Two conditions decide it, and they are separate on purpose: the business has
 * to be approved, and the listing has to be published. The first is the
 * platform's decision about a vendor and the second is the vendor's decision
 * about one of its own services, so a suspension hides a whole catalogue while
 * a draft hides one row.
 *
 * Both are also applied by `catalog.bookable()`, which is what the checkout
 * gates on. A rule enforced on reads alone leaves a service that no screen will
 * show and any id will still buy.
 *
 * Every function here takes an actor even though none of them consults one:
 * `ANONYMOUS` is a legal caller of a public catalogue, and an export with no
 * actor parameter is invisible to the two suites that check every way into a
 * row goes past a gate.
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
 * Filtering in the query rather than after it matters — a suspended vendor's
 * rows or a draft listing must not reach the caller at all, because a caller
 * that receives them will eventually forget to drop one.
 */
export async function listPublicServices(
  ctx: CoreContext,
  _actor: Actor,
  filter: { categorySlug?: string | undefined } = {},
): Promise<PublicService[]> {
  const conditions = [
    eq(vendors.status, "approved"),
    isNotNull(services.publishedAt),
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
 * `NotFoundError` whether the row is absent, belongs to a vendor who is no
 * longer approved, or has never been published. All three are deliberately the
 * same answer: a suspended business's page must not become a way to learn that
 * the business exists and has been suspended, and a draft's slug must not
 * become a way to learn what a vendor is about to launch.
 */
export async function getPublicService(
  ctx: CoreContext,
  _actor: Actor,
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
      publishedAt: services.publishedAt,
    })
    .from(services)
    .innerJoin(vendors, eq(vendors.id, services.vendorId))
    .innerJoin(categories, eq(categories.id, services.categoryId))
    .where(eq(services.slug, slug))
    .limit(1);

  if (!row) throw new NotFoundError("No such service.");

  const { vendorStatus, publishedAt, ...service } = row;
  if (!publiclyListable(vendorStatus) || publishedAt === null) {
    throw new NotFoundError("No such service.");
  }

  return service;
}
