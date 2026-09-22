import { and, eq, sql } from "drizzle-orm";
import { reviews, services } from "@occasion/db/schema";
import type { DbExecutor } from "../context.js";

/**
 * The two numbers on a listing that are summaries of something else.
 *
 * `services.rating_average` and `services.review_count` are the star rating and
 * the "(86 reviews)" beside it — and both are derived from rows in `reviews`,
 * so they are only true while something recomputes them. Until this existed
 * nothing did: the seed wrote them once and the moderation queue could reject a
 * review without either number moving. A catalogue filter over "4.8 and above"
 * is then a filter over a number that stopped describing the reviews, which is
 * the same defect as a rule enforced on reads and not on writes.
 *
 * Recomputed rather than incremented. A decision can move a review in either
 * direction — rejecting one and later keeping it again — and a counter nudged
 * up and down drifts the first time a transaction is rolled back after it. The
 * aggregate is small, it is per service, and it is exact.
 *
 * Takes an executor rather than a context: the recompute belongs in the same
 * transaction as the decision that caused it, or the queue says a review was
 * removed while the listing still counts it.
 */

/** No reviews means no rating, and zero is what the column says for that. */
const NO_REVIEWS = "0";

export async function recomputeServiceRating(
  db: DbExecutor,
  reviewId: string,
): Promise<string | null> {
  // `reviews.service_id` is nullable — deleting a service sets it null rather
  // than taking the review's history with it — so a review with no listing left
  // to summarise is an ordinary no-op, not a failure.
  const [review] = await db
    .select({ serviceId: reviews.serviceId })
    .from(reviews)
    .where(eq(reviews.id, reviewId))
    .limit(1);

  const serviceId = review?.serviceId;
  if (!serviceId) return null;

  // Approved only, which is the same set the service page publishes. A rejected
  // review that still counted towards the average would be moderated off the
  // screen and left in the number the screen leads with.
  const [aggregate] = await db
    .select({
      average: sql<string>`coalesce(round(avg(${reviews.rating})::numeric, 1)::text, ${NO_REVIEWS})`,
      total: sql<number>`count(*)::int`,
    })
    .from(reviews)
    .where(and(eq(reviews.serviceId, serviceId), eq(reviews.moderation, "approved")));

  const average = aggregate?.average ?? NO_REVIEWS;

  await db
    .update(services)
    .set({ ratingAverage: average, reviewCount: aggregate?.total ?? 0 })
    .where(eq(services.id, serviceId));

  return serviceId;
}
