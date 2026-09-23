import { Skeleton, SkeletonRows } from "@occasion/ui";

/**
 * The bookings list, before it has any.
 *
 * Its own file rather than the group's, because the group's draws a wide blurb
 * under the heading and this screen has none — the placeholder would reserve a
 * line the real page never fills, and the list would jump up when it arrived.
 *
 * The skeletons are `aria-hidden`; the wait is announced once, in words.
 */
export default function OrdersLoading() {
  return (
    <>
      <Skeleton width="260px" height="40px" className="mb-[18px] rounded-card" />

      <p role="status" className="sr-only">
        Loading your orders.
      </p>

      <SkeletonRows rows={4} />
    </>
  );
}
