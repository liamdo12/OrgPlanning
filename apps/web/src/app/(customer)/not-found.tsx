import Link from "next/link";
import { EmptyState } from "@occasion/ui";

/**
 * A screen, or a listing, that is not there — inside the shell.
 *
 * Also what a policy produces: they answer `NotFoundError` rather than "not
 * permitted", so that a refusal cannot be used to discover which rows exist. A
 * service that was withdrawn and a service that belongs to somebody else land
 * here identically, and the wording has to hold for both readings — so it does
 * not speculate about why.
 */
export default function CustomerNotFound() {
  return (
    <EmptyState
      title="Not found"
      blurb="That page or listing is not here. It may have been withdrawn, or the link may be wrong."
      action={
        <Link href="/services" className="oc-button oc-button--primary oc-button--md">
          Browse services
        </Link>
      }
    />
  );
}
