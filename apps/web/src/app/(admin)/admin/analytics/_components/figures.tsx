import type { ReactNode } from "react";
import { GlassCard, ListRow, ListStack } from "@occasion/ui";

/**
 * How a number is drawn.
 *
 * One figure, one label, one line saying what it counts. The sentence matters
 * as much as the number: "gross bookings" and "what was collected" are
 * different, and a tile that shows only a figure invites somebody to read it as
 * whichever they were expecting.
 */
export function Figure({ label, value, note }: { label: string; value: ReactNode; note?: string }) {
  return (
    <GlassCard className="grid gap-1">
      <span className="text-sm opacity-70">{label}</span>
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
      {note ? <span className="text-xs opacity-70">{note}</span> : null}
    </GlassCard>
  );
}

/**
 * A breakdown by state.
 *
 * Every state is listed, including the ones at zero. A list that hides empty
 * rows answers "how many orders are in trouble" with silence on the day the
 * answer is none, and with silence again on the day the query broke.
 */
export function Breakdown({
  title,
  counts,
  order,
  label,
}: {
  title: string;
  counts: Record<string, number>;
  order: readonly string[];
  label?: (key: string) => string;
}) {
  return (
    // `content-start` so a short list does not spread itself down a card the
    // grid has stretched to match the tallest one beside it: nine order states
    // next to four vendor statuses, and the four floating in the middle of
    // their card reads as a rendering fault.
    <GlassCard as="section" className="grid content-start gap-2">
      <h3 className="m-0 text-sm font-semibold uppercase tracking-[0.06em] opacity-70">{title}</h3>
      <ListStack>
        {order.map((key) => (
          <ListRow
            key={key}
            title={label ? label(key) : key.replaceAll("_", " ")}
            trailing={<span className="tabular-nums">{counts[key] ?? 0}</span>}
          />
        ))}
      </ListStack>
    </GlassCard>
  );
}
