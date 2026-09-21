import { Skeleton, SkeletonRows } from "@occasion/ui";

/**
 * What the shell shows while a screen's data is on its way.
 *
 * The shape of the page, not a spinner: the header and the tabs are already
 * there, so what should happen is the content taking form rather than the
 * layout collapsing and springing back.
 *
 * The skeletons are `aria-hidden`; the wait is announced once, in words.
 */
export default function CustomerLoading() {
  return (
    <>
      <div className="mb-[18px]">
        <Skeleton width="260px" height="40px" className="rounded-card" />
        <Skeleton width="min(52ch, 100%)" height="18px" className="mt-3 rounded-card" />
      </div>

      <p role="status" className="sr-only">
        Loading.
      </p>

      <SkeletonRows rows={4} />
    </>
  );
}
