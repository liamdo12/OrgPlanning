import Link from "next/link";
import { GlassCard } from "@occasion/ui";

/**
 * What a new account lands on, lines 857–881.
 *
 * A designed screen rather than a fallback: a hero with two calls to action,
 * three numbered steps, and a closing line that is true — nothing is charged
 * until a booking is confirmed, which is exactly what the checkout does.
 */

const STEPS = [
  {
    n: 1,
    title: "Start with the date",
    text: "The date and the guest count are all it takes. Everything else can change later.",
  },
  {
    n: 2,
    title: "Fill the six slots",
    text: "Photography, catering, flowers and the rest — add a vendor to a slot, or ask for quotes.",
  },
  {
    n: 3,
    title: "Book when you are ready",
    text: "A deposit holds the date. The balance is charged automatically before the event.",
  },
] as const;

export function EventEmptyState() {
  return (
    <section aria-labelledby="no-events-heading" className="max-w-[760px]">
      <div className="mb-5 rounded-hero bg-role p-[clamp(24px,4.5vw,44px)] text-surface">
        <p className="m-0 mb-3 text-label font-bold tracking-[0.14em] uppercase text-on-role-muted">
          No events yet
        </p>
        <h1
          id="no-events-heading"
          className="m-0 mb-3 font-display text-[clamp(28px,5vw,46px)] leading-[1.05] font-normal tracking-[-0.015em]"
        >
          Start with the date and the guest count.
        </h1>
        <p className="m-0 mb-6 max-w-[46ch] text-[15.5px] text-pretty text-on-role-muted">
          Everything else hangs off an event: the vendors you book, the quotes you compare, the
          deposits you pay and the day-of schedule.
        </p>

        <div className="flex flex-wrap gap-[10px]">
          <Link href="/events/new" className="oc-button oc-button--md bg-surface text-ink">
            Create an event
          </Link>
          {/*
            Outlined, with **no translucent fill**. The prototype washes this
            button with 12% of the surface colour over the green (line 865),
            which lightens the background just enough to take its own label
            under the contrast floor — axe catches it at both widths. The label
            on the plain fill clears it, and the border carries the edge the
            wash was there for.
          */}
          <Link
            href="/services"
            className="oc-button oc-button--md border border-[rgb(244_241_233/0.7)] text-surface"
          >
            Browse services first
          </Link>
        </div>
      </div>

      <ol className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(210px,1fr))] gap-[14px] p-0">
        {STEPS.map((step) => (
          <li key={step.n}>
            <GlassCard className="h-full rounded-panel p-[18px]">
              <span
                aria-hidden="true"
                className="mb-[11px] grid size-[26px] place-items-center rounded-pill bg-role-tint text-[13px] font-bold text-role"
              >
                {step.n}
              </span>
              <h2 className="m-0 mb-[5px] text-[16px]">{step.title}</h2>
              <p className="m-0 text-row text-pretty text-body">{step.text}</p>
            </GlassCard>
          </li>
        ))}
      </ol>

      <p className="mt-5 mb-0 text-row text-body">
        Nothing is charged until you confirm a booking.
      </p>
    </section>
  );
}
