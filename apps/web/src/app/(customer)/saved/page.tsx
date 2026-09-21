import Link from "next/link";
import { EmptyState, PageHeader } from "@occasion/ui";
import { requireCustomerPage } from "../../../lib/auth-guard";

export const metadata = { title: "Saved · Occasion" };

/** Rendered per request: what it shows belongs to whoever is asking. */
export const dynamic = "force-dynamic";

/**
 * Saved services — signed in.
 *
 * The gate is the first statement, and it is the page form: a page that throws
 * logs an exception for every anonymous visitor and renders the error
 * boundary, when what should happen is the login screen, coming back here
 * afterwards.
 */
export default async function SavedPage() {
  await requireCustomerPage();

  return (
    <>
      <PageHeader title="Saved" />

      <EmptyState
        // The prototype's own wording, line 1338.
        title="Nothing saved yet"
        blurb="Tap the heart on any service card and it will be here."
        action={
          <Link href="/services" className="oc-button oc-button--primary oc-button--md">
            Browse services
          </Link>
        }
      />
    </>
  );
}
