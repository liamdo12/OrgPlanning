import Link from "next/link";
import { EmptyState } from "@occasion/ui";

/**
 * A screen, or a row, that is not there.
 *
 * Also what an object policy produces: they answer `NotFoundError` rather than
 * "not permitted" so that a refusal cannot be used to discover which rows
 * exist. The wording has to hold for both readings, which is why it does not
 * speculate about why.
 */
export default function AdminNotFound() {
  return (
    <EmptyState
      title="Not found"
      blurb="That page or record is not here. It may have been removed, or the link may be wrong."
      action={
        <Link href="/admin/vendors" className="oc-button oc-button--primary oc-button--md">
          Back to vendors
        </Link>
      }
    />
  );
}
