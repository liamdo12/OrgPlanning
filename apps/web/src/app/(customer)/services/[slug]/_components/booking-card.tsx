import Link from "next/link";
import { formatMoney, type QuotedOrder, type ServiceDayState } from "@occasion/core";
import { PriceLockup, Toast, type PriceRow } from "@occasion/ui";
import { formatCalendarDay, formatDay } from "../../../../../lib/format-moment";
import { selectActiveEventAction } from "../../../actions";
import { DeferredAction } from "../../../_components/deferred-action";
import { addItemToPlanAction } from "../actions";
import { MAX_QUANTITY } from "../booking-selection";
import { ArrivalSelect, QuantityControl } from "./booking-controls";
import type { ArrivalOption } from "../booking-selection";

/**
 * The sticky aside. Lines 815–851.
 *
 * **Every figure on it comes from one call.** `quoteCheckout` runs the same
 * sequence a real checkout runs — the platform's current rates, the
 * catalogue's prices, the listing's own policy, the split, the payment plan —
 * and writes nothing. Nothing here multiplies, applies a rate or rounds: the
 * card receives amounts and hands them to the formatter. Two screens computing
 * a deposit separately is two implementations of the money rules, and the day
 * they disagree somebody is quoted one number and billed another.
 *
 * **It carries its own event switcher**, which the header also has. The
 * header's is desktop-only (line 2322), so without this one a customer on a
 * phone holding two events prices a deposit against whichever event a cookie
 * set on a laptop last named, adds a caterer to it, and is taken to that
 * event's hub. The same cookie and the same action behind it.
 *
 * Three states, and only the first shows money:
 *
 * - **an event to price against** — the five rows, the switcher, "Add to …";
 * - **signed in with no active event** — the price and a way to make one. No
 *   deposit, and no zeroed rows either: a row of dashes is a figure somebody
 *   will read as free;
 * - **signed out** — the price and the login screen, which comes back here.
 */
export function BookingCard({
  slug,
  serviceId,
  serviceTitle,
  servicePackageId,
  priceLabel,
  availability,
  event,
  events,
  quote,
  quantity,
  priceUnit,
  arrivalTime,
  arrivals,
  depositPercentLabel,
  quoteFailed,
  signedIn,
}: {
  slug: string;
  serviceId: string;
  serviceTitle: string;
  /** The tier being priced, or null for a listing sold at its base price. */
  servicePackageId: string | null;
  /** "From C$145.00 / arrangement", formatted on the server. */
  priceLabel: string;
  /** The advisory read, or null when there is no date to ask about. */
  availability: ServiceDayState | null;
  event: { id: string; name: string; eventDate: string; guestCount: number | null } | undefined;
  events: readonly { id: string; name: string }[];
  quote: QuotedOrder | null;
  quantity: number;
  priceUnit: string;
  arrivalTime: string | null;
  arrivals: readonly ArrivalOption[];
  /** "20%", from the listing's own template — never recomputed here. */
  depositPercentLabel: string | null;
  /** The quote could not be produced; the listing still renders. */
  quoteFailed: boolean;
  signedIn: boolean;
}) {
  return (
    <aside className="oc-glass sticky top-[118px] rounded-overlay border border-glass-edge-soft p-[20px]">
      <p className="m-0 mb-[2px] text-price font-bold">{priceLabel}</p>

      <AvailabilityLine state={availability} eventDate={event?.eventDate} />

      {signedIn ? <EventChoice events={events} chosen={event} /> : null}

      {event ? (
        <>
          <div className="mb-[16px] flex gap-[10px]">
            <div className="flex-1">
              <p className="oc-label mb-[6px]" id="quantity-label">
                Qty
              </p>
              <QuantityControl
                slug={slug}
                quantity={quantity}
                max={MAX_QUANTITY}
                unit={priceUnit}
              />
            </div>

            {arrivals.length > 0 ? (
              <div className="flex-1">
                <label htmlFor="arrival-time" className="oc-label mb-[6px] block">
                  Arrival
                </label>
                <ArrivalSelect slug={slug} arrivalTime={arrivalTime} options={arrivals} />
              </div>
            ) : null}
          </div>

          {quote ? (
            <PriceLockup rows={moneyRows(quote, depositPercentLabel)} />
          ) : (
            <Toast tone="warn">
              {quoteFailed
                ? "The deposit could not be worked out just now. Nothing has been booked, and the price above is still the price."
                : "This listing cannot be booked for that event."}
            </Toast>
          )}

          {/* Submitted with the selection this card was rendered from, so what
              lands in the plan is what was priced above. Every field is read
              back and re-derived by the action; these are the request, not the
              answer. */}
          <form action={addItemToPlanAction} className="mt-[16px] grid gap-[8px]">
            <input type="hidden" name="serviceId" value={serviceId} />
            <input type="hidden" name="eventId" value={event.id} />
            {servicePackageId ? (
              <input type="hidden" name="servicePackageId" value={servicePackageId} />
            ) : null}
            <input type="hidden" name="quantity" value={String(quantity)} />
            {arrivalTime ? <input type="hidden" name="arrivalTime" value={arrivalTime} /> : null}

            <button
              type="submit"
              aria-label={`Add ${serviceTitle} to ${event.name}`}
              className="oc-button oc-button--primary oc-button--lg w-full justify-center"
            >
              Add to {event.name}
            </button>
          </form>
        </>
      ) : null}

      <div className="mt-[8px] grid gap-[8px]">
        {event ? null : signedIn ? (
          // Two different situations, and offering to create an event to
          // somebody who has three is the wrong one: the choice is right above
          // this button, and the button should say so rather than send them to
          // a screen they do not need.
          events.length > 0 ? (
            <p className="m-0 text-center text-[14px] text-body">
              Choose an event above and the deposit will be worked out for its date.
            </p>
          ) : (
            <Link
              href="/events"
              className="oc-button oc-button--primary oc-button--lg w-full justify-center no-underline"
            >
              Create an event to book
            </Link>
          )
        ) : (
          <Link
            href={`/login?next=${encodeURIComponent(`/services/${slug}`)}`}
            className="oc-button oc-button--primary oc-button--lg w-full justify-center no-underline"
          >
            Sign in to book
          </Link>
        )}

        <DeferredAction
          reason="Sending one brief to several vendors is planned, and is not built yet."
          className="oc-button oc-button--secondary oc-button--md w-full justify-center border-[1.5px] border-role text-role-hover"
        >
          Get a custom quote
        </DeferredAction>
      </div>

      <p className="mt-[11px] mb-0 text-center text-[12.5px] text-body">
        You won&rsquo;t be charged until checkout.
      </p>
    </aside>
  );
}

/**
 * Which event this is being priced for. Line 819.
 *
 * A disclosure and a form, with no state of its own, and that is the point:
 * the shell's switcher holds its open/closed in a client component, and its
 * event buttons close the panel on click — which unmounts the form before the
 * browser dispatches the submit, so nothing is ever posted. That defect is
 * invisible in the header today, because the shell passes it at most one event
 * and it draws a link instead. This card is the first place the list is real.
 *
 * `<details>` also means the control works before hydration, which the money
 * beside it does not need but a person on a slow phone does.
 */
function EventChoice({
  events,
  chosen,
}: {
  events: readonly { id: string; name: string }[];
  chosen: { id: string; name: string; eventDate: string; guestCount: number | null } | undefined;
}) {
  if (events.length === 0) {
    return (
      <>
        <p className="oc-label mb-[6px]">Event</p>
        <p className="mt-0 mb-[14px] text-[14px] text-body">
          You have no events yet. One is where the vendors you book are gathered.
        </p>
      </>
    );
  }

  return (
    <>
      <p className="oc-label mb-[6px]" id="event-choice">
        Event
      </p>
      <details className="mb-[14px]">
        <summary className="w-full cursor-pointer list-none rounded-card border border-glass-edge-soft bg-field px-[13px] py-[11px] text-[14px] font-semibold">
          {chosen
            ? [
                chosen.name,
                formatCalendarDay(chosen.eventDate),
                chosen.guestCount === null ? null : `${chosen.guestCount} guests`,
              ]
                .filter(Boolean)
                .join(" · ")
            : "Choose an event"}{" "}
          <span aria-hidden="true">▾</span>
        </summary>

        <form
          action={selectActiveEventAction}
          aria-labelledby="event-choice"
          className="mt-[8px] grid gap-[6px]"
        >
          {events.map((candidate) => (
            <button
              key={candidate.id}
              type="submit"
              name="eventId"
              value={candidate.id}
              aria-pressed={candidate.id === chosen?.id}
              className="oc-chip w-full truncate text-left"
            >
              {candidate.name}
            </button>
          ))}
        </form>
      </details>
    </>
  );
}

/**
 * The five rows, or the three a fully-charged booking has. Lines 842–846.
 *
 * `buildPaymentPlan` takes the whole total at checkout when the event is
 * inside the balance lead time, when the total is below the full-payment
 * floor, or when the deposit rounds to nothing or to everything. In all of
 * those the balance is zero and there is no date — and "Balance on —" beside
 * "C$0.00" is what a customer reads as a mistake, so the rows are not drawn.
 */
function moneyRows(order: QuotedOrder, depositPercentLabel: string | null): PriceRow[] {
  const line = order.lines[0];
  const money = (amount: bigint) => formatMoney(amount, order.currency);

  const rows: PriceRow[] = [
    {
      label: line ? `${line.description} × ${line.quantity}` : "Subtotal",
      value: money(order.subtotal),
    },
    { label: "HST 13%", value: money(order.tax) },
    { label: "Total", value: money(order.total), emphasis: "total" },
  ];

  if (order.planKind === "full") {
    rows.push({
      label: "Charged at checkout",
      value: money(order.depositAmount),
      emphasis: "role",
      // Which of the three reasons applies is not on the quote, so this says
      // what is true of all of them rather than guessing at one.
      note: "This booking is paid in full at checkout.",
    });
    return rows;
  }

  rows.push({
    label: depositPercentLabel ? `Deposit today (${depositPercentLabel})` : "Deposit today",
    value: money(order.depositAmount),
    emphasis: "role",
  });

  rows.push({
    label: order.balanceDueAt ? `Balance on ${formatDay(order.balanceDueAt)}` : "Balance",
    value: money(order.balanceAmount),
  });

  return rows;
}

/**
 * "✓ Available Mar 20, 2027", line 817 — and its negative twin.
 *
 * It **reports, it does not promise.** What decides a double booking is the
 * exclusion constraint inside the checkout's own transaction; this is a read
 * taken beforehand, and two people looking at the same free date still cannot
 * both book it. The wording carries that rather than leaving it in a comment.
 *
 * Drawn in the hover green rather than the role primary: role green as text
 * over the ambient gradient measures 4.35:1, under AA.
 */
function AvailabilityLine({
  state,
  eventDate,
}: {
  state: ServiceDayState | null;
  eventDate: string | undefined;
}) {
  if (state === null || eventDate === undefined) {
    return (
      <p className="m-0 mb-[16px] text-[13.5px] font-semibold text-body">
        Pick an event and this will say whether the date is free.
      </p>
    );
  }

  const day = formatCalendarDay(eventDate);

  if (state === "free") {
    return (
      <p className="m-0 mb-[16px] text-[13.5px] font-semibold text-role-hover">
        ✓ Looks free on {day}
      </p>
    );
  }

  return (
    <p className="m-0 mb-[16px] text-[13.5px] font-semibold text-body">
      {state === "blacked_out" ? `The business is closed on ${day}` : `Already booked on ${day}`}
    </p>
  );
}
