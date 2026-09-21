import Link from "next/link";
import { EmptyState, PageHeader } from "@occasion/ui";
import { requireCustomerPage } from "../../../lib/auth-guard";

export const metadata = { title: "Events · Occasion" };

/** Rendered per request: what it shows belongs to whoever is asking. */
export const dynamic = "force-dynamic";

/**
 * The event list — signed in, and the destination the header's chip offers
 * while there is nothing to switch between.
 *
 * The hub itself, the slots and the budget bar arrive with the planning
 * module. This exists now because the chip and the tab both point at it, and a
 * navigation control that leads to a 404 is worse than one that leads to an
 * honest empty screen.
 */
export default async function EventsPage() {
  await requireCustomerPage();

  return (
    <>
      <PageHeader title="Your events" />

      <EmptyState
        title="No events yet"
        blurb="An event is a date, a neighbourhood, a guest count and a budget you can change later. Making one is the next thing this screen will do."
        action={
          <Link href="/services" className="oc-button oc-button--primary oc-button--md">
            Browse services
          </Link>
        }
      />
    </>
  );
}
