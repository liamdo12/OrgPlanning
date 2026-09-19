import Link from "next/link";

/**
 * The next page of a list.
 *
 * A link carrying the cursor rather than a button holding state, for the same
 * reason the drawers are query parameters: the page it leads to is
 * server-rendered behind the same gate, it can be shared, and the back button
 * does what it looks like it does.
 *
 * It replaces the page rather than appending to it. An admin queue is worked
 * from the front, and a growing page is one whose keyboard order changes under
 * somebody halfway down it.
 */
export function LoadMore({ href, label = "Next page" }: { href: string; label?: string }) {
  return (
    <div className="mt-4 flex justify-center">
      <Link href={href} className="oc-button oc-button--ghost oc-button--sm no-underline">
        {label}
      </Link>
    </div>
  );
}
