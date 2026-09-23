import Link from "next/link";
import type { EventHub } from "@occasion/core";
import { BudgetBar } from "./budget-bar";
import { DaySchedule } from "./day-schedule";
import { EventSwitcherForm } from "./event-switcher-form";
import { PaymentsPanel } from "./payments-panel";
import { SlotList, checkoutVendors, inPlanCount } from "./slot-list";

/**
 * The planner, lines 884–933.
 *
 * One composition for both routes — `/events` renders the active event and
 * `/events/{id}` renders the one in the path — so the two cannot drift, and
 * "one domain call per render" has a single place to be true.
 *
 * Everything here is a render over one `eventHub` result. No panel fetches
 * anything of its own: six slots that each asked a question would be six
 * queries for a screen that already has the answer.
 */

const dayFormat = new Intl.DateTimeFormat("en-CA", {
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "America/Toronto",
});

export function EventHubView({
  hub,
  events,
}: {
  hub: EventHub;
  /** Everything this customer is planning, for the switcher. */
  events: ReadonlyArray<{ id: string; name: string }>;
}) {
  return (
    <section aria-labelledby="hub-heading">
      <div className="mb-[18px] flex flex-wrap items-end justify-between gap-[14px]">
        <div>
          <h1
            id="hub-heading"
            className="m-0 mb-[5px] font-display text-[clamp(29px,4.4vw,44px)] leading-[1.05] font-normal"
          >
            {hub.name}
          </h1>
          <p className="m-0 text-[14.5px] text-body">{meta(hub)}</p>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <EventSwitcherForm events={events} activeId={hub.id} />
          <Link
            href={`/events/${hub.id}/edit`}
            className="oc-button oc-button--secondary oc-button--md"
          >
            Edit event
          </Link>
        </div>
      </div>

      <BudgetBar budget={hub.budget} currency={hub.currency} />

      <h2 className="m-0 mb-3 text-section">Vendor slots</h2>
      <SlotList eventId={hub.id} items={hub.items} />

      <div className="grid grid-cols-[repeat(auto-fit,minmax(270px,1fr))] gap-[18px]">
        <DaySchedule entries={hub.schedule} />
        <PaymentsPanel
          eventId={hub.id}
          payments={hub.payments}
          currency={hub.currency}
          inPlan={inPlanCount(hub.items)}
          vendors={checkoutVendors(hub.items)}
        />
      </div>
    </section>
  );
}

/**
 * Date · venue · guests, line 2357.
 *
 * The prototype also counts the days to go, against a date written into the
 * file. Nothing here can do that honestly on the server without reading the
 * domain clock into a string the browser may then disagree with by a day, so
 * the line states the facts and leaves the arithmetic out.
 */
function meta(hub: EventHub): string {
  // Midday, so the date reads as the day it is rather than sliding back one in
  // a zone behind UTC. The column is a `date`, which has no time at all.
  const at = new Date(`${hub.eventDate}T12:00:00Z`);

  return [
    Number.isNaN(at.getTime()) ? "Date not set" : dayFormat.format(at),
    hub.venueName ?? "Venue not set",
    hub.guestCount === null ? "Guest count not set" : `${hub.guestCount} guests`,
  ].join(" · ");
}
