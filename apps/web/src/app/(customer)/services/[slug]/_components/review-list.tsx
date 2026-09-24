import { GlassCard, Rating } from "@occasion/ui";
import { formatDay } from "../../../../../lib/format-moment";

/**
 * What people said. Lines 804–812.
 *
 * Only reviews moderation approved reach here — the domain filters them in the
 * query rather than after it, so a report that was upheld takes the words off
 * the screen rather than leaving them for a caller to remember to drop.
 *
 * A review with no publication date is drawn without one rather than with a
 * guess: `published_at` is null until it is published, and "today" would be a
 * claim about when somebody wrote it.
 */
export function ReviewList({
  reviews,
}: {
  reviews: ReadonlyArray<{
    id: string;
    rating: number;
    body: string | null;
    authorName: string;
    publishedAt: Date | null;
  }>;
}) {
  return (
    <div className="grid gap-[12px] [grid-template-columns:repeat(auto-fit,minmax(240px,1fr))]">
      {reviews.map((review) => (
        <GlassCard key={review.id} as="article" className="p-[16px]">
          <p className="m-0 mb-[6px] flex flex-wrap items-baseline gap-[6px] text-[13.5px] text-body">
            {/* No count: this is one person's own rating, and "(1)" beside it
                reads as an average of a single review. Line 808. */}
            <Rating average={review.rating} />
            <span aria-hidden="true">·</span>
            <span>{review.authorName}</span>
            {review.publishedAt ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{formatDay(review.publishedAt)}</span>
              </>
            ) : null}
          </p>
          {review.body ? (
            <p className="m-0 text-[14px] text-pretty text-body">{review.body}</p>
          ) : null}
        </GlassCard>
      ))}
    </div>
  );
}
