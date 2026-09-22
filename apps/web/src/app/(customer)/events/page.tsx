import { eventHub, listEventsForOwner } from "@occasion/core";
import { requireCustomerPage } from "../../../lib/auth-guard";
import { resolveActiveEvent } from "../../../lib/active-event";
import { createRequestContext } from "../../../lib/core";
import { EventEmptyState } from "./_components/event-empty-state";
import { EventHubView } from "./_components/hub";

export const metadata = { title: "Events · Occasion" };

/** Rendered per request: what it shows belongs to whoever is asking. */
export const dynamic = "force-dynamic";

/**
 * The planner for the event being planned, or the screen a new account lands
 * on.
 *
 * The active event is a cookie the server writes, and it is a **selection**
 * rather than an authority: `resolveActiveEvent` loads it and checks the owner
 * on every read, and anything it cannot resolve is the same answer as no
 * cookie at all. When there is none, the first of this customer's own events is
 * shown — a planner that refused to draw anything until somebody pressed a
 * switcher would be an empty screen for an account with events on it.
 */
export default async function EventsPage() {
  const actor = await requireCustomerPage();
  const ctx = createRequestContext();

  const events = await listEventsForOwner(ctx, actor);
  if (events.length === 0) return <EventEmptyState />;

  const active = await resolveActiveEvent(ctx, actor);
  // `events` is not empty above, so the fallback is a real row; the cast says
  // so rather than inventing a second emptiness check the reader has to trust.
  const first = events[0] as (typeof events)[number];
  const showing = events.find((event) => event.id === active?.id) ?? first;

  const hub = await eventHub(ctx, actor, showing.id);

  return <EventHubView hub={hub} events={events.map(({ id, name }) => ({ id, name }))} />;
}
