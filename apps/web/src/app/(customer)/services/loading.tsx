import { Skeleton } from "@occasion/ui";

/**
 * The results grid, before it has results.
 *
 * The group's own loading file draws four stacked rows, which is the shape of
 * a list and not of this screen: the cards are a grid of 4/3 media blocks, and
 * a placeholder the wrong shape makes the page jump when the real one arrives.
 *
 * The skeletons are `aria-hidden`; the wait is announced once, in words.
 */
export default function ServicesLoading() {
  return (
    <>
      <div className="mb-[18px]">
        <Skeleton width="260px" height="40px" className="rounded-card" />
        <Skeleton width="min(52ch, 100%)" height="18px" className="mt-3 rounded-card" />
      </div>

      <p role="status" className="sr-only">
        Loading services.
      </p>

      <div className="grid gap-[18px] [grid-template-columns:repeat(auto-fill,minmax(230px,1fr))]">
        {Array.from({ length: 8 }, (_card, index) => (
          <div key={index}>
            <Skeleton height="0" className="aspect-[4/3] rounded-[18px]" />
            <Skeleton width="60%" height="15px" className="mt-[10px] rounded-card" />
            <Skeleton width="85%" height="14px" className="mt-[6px] rounded-card" />
            <Skeleton width="40%" height="15px" className="mt-[6px] rounded-card" />
          </div>
        ))}
      </div>
    </>
  );
}
