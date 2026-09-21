import Link from "next/link";
import { EmptyState, PageHeader } from "@occasion/ui";

export const metadata = { title: "Explore · Occasion" };

/**
 * Explore — **public**, and one of the three screens that are.
 *
 * The prototype's rule, line 2013: Explore, Results and Service detail render
 * for anybody; every other customer route sends the visitor to the login
 * screen. This page therefore has no gate, and is named in the public
 * allowlist in `src/customer-authorization.test.ts` — which is the point of
 * that list: being public is a decision somebody wrote down, not the absence of
 * a line.
 *
 * The hero, the category tiles and the public-event feed arrive with the
 * catalogue read they draw from. What is here is what can be true today: the
 * search control in the header works, and it leads somewhere.
 */
export default function ExplorePage() {
  return (
    <>
      <PageHeader
        title="Plan the whole thing in one place."
        blurb="Florists, caterers, cakes, photography and more across Toronto. Search by what you need, where it is and how many people are coming."
      />

      <EmptyState
        title="The marketplace opens here"
        blurb="Browsing, the category tiles and the public events feed arrive with the catalogue. The search in the header already works — try it."
        action={
          <Link href="/services" className="oc-button oc-button--primary oc-button--md">
            Browse services
          </Link>
        }
      />
    </>
  );
}
