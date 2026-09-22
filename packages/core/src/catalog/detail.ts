import { and, asc, desc, eq, isNotNull, sql } from "drizzle-orm";
import {
  categories,
  orders,
  reviews,
  savedServices,
  serviceMedia,
  servicePackages,
  services,
  users,
  vendors,
} from "@occasion/db/schema";
import type { CoreContext } from "../context.js";
import { NotFoundError } from "../errors.js";
import { isUsable, type Actor } from "../identity/actor.js";

/**
 * One service's own page.
 *
 * The same two conditions as the list — approved vendor, published listing —
 * and the same refusal when either fails: `NotFoundError`, identical to the one
 * an unknown slug gets. A suspended business's page must not become a way to
 * learn the business exists and has been suspended, and a draft's slug must not
 * become a way to learn what a vendor is about to launch.
 *
 * Everything the page draws comes back from here, because the alternative is a
 * screen issuing five reads and an N+1 for the pictures.
 */

export type ServiceDetailPackage = {
  id: string;
  name: string;
  description: string | null;
  unitPrice: bigint;
  currency: string;
};

export type ServiceDetailMedia = {
  id: string;
  url: string;
  altText: string | null;
};

export type ServiceDetailReview = {
  id: string;
  rating: number;
  body: string | null;
  authorName: string;
  publishedAt: Date | null;
};

/**
 * What the page says about the business, and nothing more.
 *
 * Tenure and a count of completed bookings, both derived. The prototype's third
 * fact — "responds in ~2h" — is absent: there is no response-time column and no
 * record of message latency to compute one from, and a number invented for a
 * screen is a number a vendor will be held to.
 */
export type VendorPublicFacts = {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  baseArea: string | null;
  /** When the platform approved the business, which is what tenure counts from. */
  approvedAt: Date | null;
  /** Bookings this business has seen through to completion. */
  completedOrders: number;
};

export type ServiceDetail = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  categorySlug: string;
  categoryName: string;
  basePrice: bigint;
  currency: string;
  priceUnit: string;
  bookingMode: string;
  badge: string | null;
  areaLabel: string | null;
  ratingAverage: number;
  reviewCount: number;
  toneStart: string | null;
  toneEnd: string | null;
  vendor: VendorPublicFacts;
  packages: ServiceDetailPackage[];
  media: ServiceDetailMedia[];
  /** Approved only. A rejected review is not content the platform still shows. */
  reviews: ServiceDetailReview[];
  /** Whether the caller has saved it. Always false for anyone not signed in. */
  saved: boolean;
};

export async function getServiceDetail(
  ctx: CoreContext,
  actor: Actor,
  slug: string,
): Promise<ServiceDetail> {
  const [row] = await ctx.db
    .select({
      id: services.id,
      slug: services.slug,
      title: services.title,
      description: services.description,
      categorySlug: categories.slug,
      categoryName: categories.name,
      basePrice: services.basePrice,
      currency: services.currency,
      priceUnit: services.priceUnit,
      bookingMode: services.bookingMode,
      badge: services.badge,
      areaLabel: services.areaLabel,
      ratingAverage: sql<number>`${services.ratingAverage}::float8`.mapWith(Number),
      reviewCount: services.reviewCount,
      toneStart: services.toneStart,
      toneEnd: services.toneEnd,
      vendorId: vendors.id,
      vendorSlug: vendors.slug,
      vendorName: vendors.name,
      vendorTagline: vendors.tagline,
      vendorBaseArea: vendors.baseArea,
      vendorApprovedAt: vendors.approvedAt,
      // Correlated, and safe because the outer query has joins: Drizzle
      // qualifies both sides with their tables, so `vendor_id` inside resolves
      // to the orders table and the one outside to the vendors table.
      completedOrders: sql<number>`(
        select count(*)::int from ${orders}
        where ${orders.vendorId} = ${vendors.id} and ${orders.state} = 'completed'
      )`,
    })
    .from(services)
    .innerJoin(vendors, eq(vendors.id, services.vendorId))
    .innerJoin(categories, eq(categories.id, services.categoryId))
    .where(
      and(eq(services.slug, slug), eq(vendors.status, "approved"), isNotNull(services.publishedAt)),
    )
    .limit(1);

  if (!row) throw new NotFoundError("No such service.");

  const [packages, media, approvedReviews, saved] = await Promise.all([
    ctx.db
      .select({
        id: servicePackages.id,
        name: servicePackages.name,
        description: servicePackages.description,
        unitPrice: servicePackages.unitPrice,
        currency: servicePackages.currency,
      })
      .from(servicePackages)
      .where(eq(servicePackages.serviceId, row.id))
      .orderBy(asc(servicePackages.sortOrder), asc(servicePackages.name)),

    ctx.db
      .select({
        id: serviceMedia.id,
        url: serviceMedia.url,
        altText: serviceMedia.altText,
      })
      .from(serviceMedia)
      .where(eq(serviceMedia.serviceId, row.id))
      .orderBy(asc(serviceMedia.sortOrder)),

    // `moderation = 'approved'` in the query, not after it. A rejected review
    // that reaches the caller is one somebody has to remember to drop, and the
    // whole point of deciding a report is that the words stop being published.
    ctx.db
      .select({
        id: reviews.id,
        rating: reviews.rating,
        body: reviews.body,
        authorName: users.fullName,
        publishedAt: reviews.publishedAt,
      })
      .from(reviews)
      .innerJoin(users, eq(users.id, reviews.authorUserId))
      .where(and(eq(reviews.serviceId, row.id), eq(reviews.moderation, "approved")))
      .orderBy(desc(reviews.createdAt)),

    savedByActor(ctx, actor, row.id),
  ]);

  const {
    vendorId,
    vendorSlug,
    vendorName,
    vendorTagline,
    vendorBaseArea,
    vendorApprovedAt,
    completedOrders,
    ...service
  } = row;

  return {
    ...service,
    vendor: {
      id: vendorId,
      slug: vendorSlug,
      name: vendorName,
      tagline: vendorTagline,
      baseArea: vendorBaseArea,
      approvedAt: vendorApprovedAt,
      completedOrders,
    },
    packages,
    media,
    reviews: approvedReviews,
    saved,
  };
}

/**
 * Whether this caller has saved this service.
 *
 * Anonymous is false without a query: there is nobody to have saved it, and an
 * account that is not active is in no position to be shown its own shortlist
 * either. `isUsable` is the same predicate `toggleSaved` refuses on, so the
 * heart shown and the heart that can be pressed agree.
 */
async function savedByActor(ctx: CoreContext, actor: Actor, serviceId: string): Promise<boolean> {
  if (!isUsable(actor)) return false;

  const [row] = await ctx.db
    .select({ id: savedServices.id })
    .from(savedServices)
    .where(and(eq(savedServices.userId, actor.userId), eq(savedServices.serviceId, serviceId)))
    .limit(1);

  return row !== undefined;
}
