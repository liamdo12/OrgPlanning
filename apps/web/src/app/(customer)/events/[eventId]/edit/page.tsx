import Link from "next/link";
import { notFound } from "next/navigation";
import { NotFoundError, eventHub, formatMoney } from "@occasion/core";
import { requireCustomerPage } from "../../../../../lib/auth-guard";
import { createRequestContext } from "../../../../../lib/core";
import { CancelEventDialog } from "../../_components/cancel-event-dialog";
import { EventForm } from "../../_components/event-form";
import { bookedCategories } from "../../_components/slot-list";

export const metadata = { title: "Edit event · Occasion" };

/** Rendered per request: what it shows belongs to whoever is asking. */
export const dynamic = "force-dynamic";

/**
 * The same form, loaded.
 *
 * Read through the planner rather than the bare event, because the form needs
 * two things the event row does not carry: what is already committed against
 * the budget, and which categories have a vendor booked in — which is what
 * decides whether a date change is going to be refused.
 */
export default async function EditEventPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const actor = await requireCustomerPage();
  const ctx = createRequestContext();
  const { eventId } = await params;

  let hub;
  try {
    hub = await eventHub(ctx, actor, eventId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const booked = bookedCategories(hub.items);

  return (
    <section className="max-w-[760px]">
      <Link
        href={`/events/${hub.id}`}
        className="mb-3 inline-block text-row font-semibold text-body"
      >
        ← {hub.name}
      </Link>
      <h1 className="m-0 mb-[6px] font-display text-[clamp(27px,4vw,40px)] font-normal">
        Edit event
      </h1>
      <p className="m-0 mb-[22px] text-[14px] text-pretty text-body">
        Vendors you have already booked were given these details. Changing the guest count does not
        re-price anything on its own, and the date cannot move while a booking is live.
      </p>

      <EventForm
        mode="edit"
        values={{
          id: hub.id,
          name: hub.name,
          eventDate: hub.eventDate,
          // The column is a `time`; the input wants `HH:MM`.
          startTime: hub.startTime?.slice(0, 5) ?? "",
          venueName: hub.venueName ?? "",
          guestCount: hub.guestCount,
          budgetDollars: hub.budget.budget === null ? 0 : Number(hub.budget.budget / 100n),
          visibility: hub.visibility,
        }}
        bookedCategories={booked}
        committed={formatMoney(hub.budget.committed, hub.currency)}
      />

      <CancelEventDialog eventId={hub.id} bookedCategories={booked} />
    </section>
  );
}
