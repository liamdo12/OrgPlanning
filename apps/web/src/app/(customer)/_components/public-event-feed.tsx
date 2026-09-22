import Link from "next/link";
import { GlassCard, Pill } from "@occasion/ui";
import type { PublicEvent } from "@occasion/core";
import { formatCalendarDay } from "../../../lib/format-moment";
import { MediaPlaceholder } from "./media-placeholder";

/**
 * What Toronto is planning. Lines 584–609.
 *
 * Five facts about somebody else's event and nothing more: its name, its date,
 * the neighbourhood, a **band** for the guest count and how many services are
 * booked. Never the owner, never the venue, never which businesses, never any
 * money. The projection is the boundary and the domain asserts it column by
 * column; this screen only draws what comes back.
 *
 * Two things the canvas draws are not here, because there is nothing behind
 * them. The kind pill ("Birthday", "Wedding", line 594) has no column, and the
 * price line (line 603) would be money about a stranger's event — which is
 * exactly what the projection refuses. The card carries the booked count in
 * that corner instead, which is a real number about a real event.
 *
 * Rendered **only when the visitor is signed out**, as the prototype gates it
 * (line 584). Somebody with their own event to plan does not need a row of
 * other people's.
 */
export function PublicEventFeed({ events }: { events: readonly PublicEvent[] }) {
  return (
    <section>
      <div className="mt-[38px] mb-[6px] flex flex-wrap items-baseline justify-between gap-[12px]">
        <h2 className="m-0 font-display text-[27px] font-normal">Events happening in Toronto</h2>
        <p className="m-0 text-[13.5px] text-body">
          Public events anyone can browse. Log in to plan your own.
        </p>
      </div>

      <div className="mt-[14px] grid gap-[16px] [grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]">
        {events.map((event) => (
          <GlassCard key={event.id} as="article" className="flex flex-col overflow-hidden p-0">
            <div className="relative aspect-[16/9]">
              <MediaPlaceholder toneStart={null} toneEnd={null} />
            </div>

            <div className="flex flex-1 flex-col p-[15px]">
              <p className="m-0 mb-[4px] text-[12px] font-bold tracking-[0.07em] text-body uppercase">
                {formatCalendarDay(event.eventDate)}
              </p>
              <h3 className="m-0 mb-[4px] text-[16.5px] font-bold">{event.name}</h3>
              <p className="m-0 mb-[12px] text-[13.5px] text-body">
                {[event.neighbourhood, event.guestBand].filter(Boolean).join(" · ")}
              </p>

              <div className="mt-auto flex items-center justify-between gap-[10px]">
                <Pill>
                  {event.bookedServices} {event.bookedServices === 1 ? "service" : "services"}{" "}
                  booked
                </Pill>
                <Link
                  href="/signup"
                  className="oc-button oc-button--secondary oc-button--sm no-underline"
                >
                  Plan yours
                </Link>
              </div>
            </div>
          </GlassCard>
        ))}
      </div>
    </section>
  );
}
