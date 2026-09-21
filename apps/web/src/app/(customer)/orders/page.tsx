import Link from "next/link";
import { EmptyState, PageHeader } from "@occasion/ui";
import { requireCustomerPage } from "../../../lib/auth-guard";

export const metadata = { title: "Your orders · Occasion" };

/** Rendered per request: what it shows belongs to whoever is asking. */
export const dynamic = "force-dynamic";

/**
 * The customer's own orders — signed in.
 *
 * Present now because the header's Orders button points here (line 422). The
 * list needs a customer order read: the ones that exist today refuse a
 * customer outright, which is the same gap that keeps the booked-services
 * strip out of the shell.
 */
export default async function OrdersPage() {
  await requireCustomerPage();

  return (
    <>
      <PageHeader title="Your orders" />

      <EmptyState
        title="No orders yet"
        blurb="Everything you book will be here, with what has been paid, what is scheduled and the terms it was booked under."
        action={
          <Link href="/services" className="oc-button oc-button--primary oc-button--md">
            Browse services
          </Link>
        }
      />
    </>
  );
}
