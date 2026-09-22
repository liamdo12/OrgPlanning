import { and, desc, eq, isNotNull } from "drizzle-orm";
import { categories, savedServices, services, vendors } from "@occasion/db/schema";
import type { CoreContext } from "../context.js";
import { NotFoundError, UnauthenticatedError } from "../errors.js";
import { isAuthenticated, isUsable, type Actor } from "../identity/actor.js";

/**
 * A customer's shortlist.
 *
 * Not audited. The audit log answers for what the platform did to somebody's
 * account, money or listing; a person deciding they like a florist is none of
 * those, and writing a row every time a heart is pressed would bury the entries
 * that matter under the ones that do not.
 *
 * Saving is still a write, so it refuses an account that may not act — and it
 * refuses a service the caller could not have found, because the shortlist must
 * not become a way to keep a draft or a suspended business's listing reachable
 * after it stopped being listable.
 */

export type SavedService = {
  id: string;
  slug: string;
  title: string;
  vendorName: string;
  categoryName: string;
  basePrice: bigint;
  currency: string;
  priceUnit: string;
  bookingMode: string;
  toneStart: string | null;
  toneEnd: string | null;
  savedAt: Date;
};

export type SaveResult = {
  serviceId: string;
  saved: boolean;
};

/**
 * Saves a service, or unsaves one that was already saved.
 *
 * One call for both directions, because the screen has one control. The insert
 * is `on conflict do nothing` against the `(user_id, service_id)` unique key,
 * so two taps racing each other cannot produce two rows.
 */
export async function toggleSaved(
  ctx: CoreContext,
  actor: Actor,
  serviceId: string,
): Promise<SaveResult> {
  // Not a validation failure and not a refusal: there is nothing wrong with the
  // request, it just needs somebody to belong to. A caller that cannot tell the
  // two apart shows an error beside the heart instead of offering to sign in.
  if (!isAuthenticated(actor)) throw new UnauthenticatedError();
  if (!isUsable(actor)) throw new NotFoundError("No such service.");

  // The same conditions the catalogue is read under, so a listing that has
  // stopped being listable cannot be added to a shortlist — and the refusal is
  // the same `NotFoundError` an unknown id gets.
  const [service] = await ctx.db
    .select({ id: services.id })
    .from(services)
    .innerJoin(vendors, eq(vendors.id, services.vendorId))
    .where(
      and(
        eq(services.id, serviceId),
        eq(vendors.status, "approved"),
        isNotNull(services.publishedAt),
      ),
    )
    .limit(1);

  if (!service) throw new NotFoundError("No such service.");

  const removed = await ctx.db
    .delete(savedServices)
    .where(and(eq(savedServices.userId, actor.userId), eq(savedServices.serviceId, service.id)))
    .returning({ id: savedServices.id });

  if (removed.length > 0) return { serviceId: service.id, saved: false };

  await ctx.db
    .insert(savedServices)
    .values({ userId: actor.userId, serviceId: service.id })
    .onConflictDoNothing();

  return { serviceId: service.id, saved: true };
}

/**
 * The shortlist, newest first.
 *
 * Filtered the same way the catalogue is, so a saved listing whose business has
 * since been suspended drops off the screen rather than sitting there as a card
 * that 404s when it is opened. The row stays in the table: reinstating the
 * business brings the shortlist back rather than having quietly emptied it.
 */
export async function listSaved(ctx: CoreContext, actor: Actor): Promise<SavedService[]> {
  if (!isUsable(actor)) return [];

  return ctx.db
    .select({
      id: services.id,
      slug: services.slug,
      title: services.title,
      vendorName: vendors.name,
      categoryName: categories.name,
      basePrice: services.basePrice,
      currency: services.currency,
      priceUnit: services.priceUnit,
      bookingMode: services.bookingMode,
      toneStart: services.toneStart,
      toneEnd: services.toneEnd,
      savedAt: savedServices.createdAt,
    })
    .from(savedServices)
    .innerJoin(services, eq(services.id, savedServices.serviceId))
    .innerJoin(vendors, eq(vendors.id, services.vendorId))
    .innerJoin(categories, eq(categories.id, services.categoryId))
    .where(
      and(
        eq(savedServices.userId, actor.userId),
        eq(vendors.status, "approved"),
        isNotNull(services.publishedAt),
      ),
    )
    .orderBy(desc(savedServices.createdAt), desc(services.id));
}
