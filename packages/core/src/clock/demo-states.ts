import { and, asc, eq, gt, inArray, isNotNull } from "drizzle-orm";
import { events, orders, seedMeta } from "@occasion/db/schema";
import type { CoreContext } from "../context.js";
import { DEFAULT_TIMEZONE, eventEndInstant } from "../ordering/schedule.js";

/**
 * The four moments the demo jumps between.
 *
 * The prototype hard-codes them as strings — `Sep 15, 2026 · now`,
 * `Mar 6, 2027 · event−14d` (lines 2154–2158). Those were true on the day it
 * was drawn and are a lie on every other day, which is the whole reason the
 * seed stores instants as offsets from `seed_meta.anchor_at` rather than as
 * literals. These are computed the same way, so reseeding in six months moves
 * all four rather than leaving the screen pointing at last spring.
 *
 * Two of them are anchor arithmetic. The other two are read off the work the
 * seeded orders actually scheduled — `event − 14 days` is whenever the first
 * balance falls due, and there is no honest way to derive that from the anchor
 * alone, because it depends on when somebody's event is.
 */

export type DemoClockState = {
  /** Stable across reseeds, so a selected state survives one. */
  key: "now" | "cooling_window" | "balance_due" | "auto_complete";
  /** What the moment is, e.g. `event−14d`. The prototype's own shorthand. */
  name: string;
  at: Date;
};

/**
 * The states, in the prototype's order.
 *
 * Returns an empty list when there is no seed: the screen then says the demo
 * data is missing rather than offering four buttons that move time to nothing
 * in particular.
 */
export async function demoClockStates(ctx: CoreContext): Promise<DemoClockState[]> {
  const [meta] = await ctx.db
    .select({ anchorAt: seedMeta.anchorAt })
    .from(seedMeta)
    .orderBy(asc(seedMeta.seededAt))
    .limit(1);

  if (!meta) return [];

  const anchor = meta.anchorAt;
  const states: DemoClockState[] = [
    { key: "now", name: "now", at: anchor },
    // The free-cancellation window, which is also when the first deposit share
    // becomes transferable. Line 2156.
    { key: "cooling_window", name: "+48h", at: new Date(anchor.getTime() + 48 * 3_600_000) },
  ];

  // The earliest balance still waiting to be charged, and the event it belongs
  // to.
  //
  // Read from the **order's** due date rather than from its job's `run_after`.
  // The two agree until a job fails: a retry moves `run_after` to a few minutes
  // from now, and a state derived from it would collapse from "March 2027" to
  // "this afternoon" — relabelling the demo's own moment because a charge
  // bounced.
  const [next] = await ctx.db
    .select({
      balanceDueAt: orders.balanceDueAt,
      eventDate: events.eventDate,
      timezone: events.timezone,
    })
    .from(orders)
    .leftJoin(events, eq(events.id, orders.eventId))
    .where(
      and(
        isNotNull(orders.balanceDueAt),
        gt(orders.balanceAmount, 0n),
        inArray(orders.state, ["confirmed", "balance_due", "action_required"]),
      ),
    )
    .orderBy(asc(orders.balanceDueAt))
    .limit(1);

  if (next?.balanceDueAt) {
    states.push({ key: "balance_due", name: "event−14d", at: next.balanceDueAt });

    if (next.eventDate) {
      const end = eventEndInstant(next.eventDate, next.timezone || DEFAULT_TIMEZONE);
      states.push({
        key: "auto_complete",
        name: "event+72h",
        at: new Date(end.getTime() + 72 * 3_600_000),
      });
    }
  }

  return states;
}
