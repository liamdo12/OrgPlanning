import { requireCustomerPage } from "../../../../lib/auth-guard";
import { EventForm } from "../_components/event-form";

export const metadata = { title: "Create an event · Occasion" };

/** Rendered per request: the gate decides whether it renders at all. */
export const dynamic = "force-dynamic";

/**
 * A blank event.
 *
 * Its own heading, intro and call to action rather than the edit screen with
 * fields emptied (line 2369): somebody arriving here has nothing yet, and the
 * copy that tells an owner their vendors will see a change is meaningless to
 * them.
 *
 * Nothing is loaded. A new event has no slots, no bookings and no committed
 * total, so there is nothing to read.
 */
export default async function NewEventPage() {
  await requireCustomerPage();

  return (
    <section className="max-w-[760px]">
      <h1 className="m-0 mb-[6px] font-display text-[clamp(27px,4vw,40px)] font-normal">
        Create an event
      </h1>
      <p className="m-0 mb-[22px] text-[14px] text-pretty text-body">
        Only the date and guest count are needed to start. Vendors see these details when you ask
        for a quote.
      </p>

      <EventForm
        mode="create"
        values={{
          name: "",
          eventDate: "",
          startTime: "",
          venueName: "",
          guestCount: null,
          budgetDollars: 0,
          visibility: "private",
        }}
      />
    </section>
  );
}
