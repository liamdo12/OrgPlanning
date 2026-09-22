import { notFound } from "next/navigation";
import { NotFoundError, eventHub, listEventsForOwner } from "@occasion/core";
import { requireCustomerPage } from "../../../../lib/auth-guard";
import { createRequestContext } from "../../../../lib/core";
import { EventHubView } from "../_components/hub";

export const metadata = { title: "Event · Occasion" };

/** Rendered per request: what it shows belongs to whoever is asking. */
export const dynamic = "force-dynamic";

/**
 * One event, from the path.
 *
 * **It does not read the cookie and does not write one.** A server component
 * cannot set a cookie, so a page that "remembered" what it was showing would
 * have to write one from the browser — which drops `httpOnly`. The switcher on
 * the hub is a form for exactly that reason, and this route needs no selection
 * at all: the id is in the URL.
 *
 * Two refusals, two shapes. An administrator never reaches the load:
 * `requireCustomerPage()` runs first and sends them to their own screens,
 * because they are signed in already and the login screen would be a dead end.
 * Another customer's event reaches the policy and comes back as `NotFoundError`
 * — the same answer as an event that does not exist, so the page cannot be used
 * to find out which ids are real.
 */
export default async function EventPage({ params }: { params: Promise<{ eventId: string }> }) {
  const actor = await requireCustomerPage();
  const ctx = createRequestContext();
  const { eventId } = await params;

  let hub;
  let events;
  try {
    [hub, events] = await Promise.all([
      eventHub(ctx, actor, eventId),
      listEventsForOwner(ctx, actor),
    ]);
  } catch (error) {
    // Only a refusal. Anything else is a real fault and belongs on the error
    // boundary rather than dressed up as a missing page.
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  return <EventHubView hub={hub} events={events.map(({ id, name }) => ({ id, name }))} />;
}
