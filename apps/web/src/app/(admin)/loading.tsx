import { Skeleton, SkeletonRows } from "@occasion/ui";

/**
 * What the shell shows while a screen's data is on its way.
 *
 * The shape of a list, not a spinner: an admin moving between sections should
 * see the page they asked for taking form rather than the layout collapsing and
 * springing back. The heading block matches `PageHeader`'s own metrics.
 *
 * The skeletons are `aria-hidden`; this announces the wait once, in words.
 */
export default function AdminLoading() {
  return (
    <>
      <div className="mb-[18px]">
        <Skeleton width="220px" height="40px" className="rounded-card" />
        <Skeleton width="min(52ch, 100%)" height="18px" className="mt-3 rounded-card" />
      </div>

      <p role="status" className="sr-only">
        Loading.
      </p>

      <SkeletonRows rows={6} />
    </>
  );
}
