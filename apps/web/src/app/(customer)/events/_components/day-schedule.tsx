import { GlassPanel } from "@occasion/ui";
import type { ScheduleEntry } from "@occasion/core";
import { Timeline } from "./timeline";

/**
 * The running order of the day, lines 917–922.
 *
 * The wording lives here rather than in the domain, which returns structure:
 * `dayOfSchedule` answers what happens and when, and a domain that returned
 * "Flowers arrive · Bloom & Co" would have to be edited to change a separator.
 *
 * An empty schedule says so. Nothing here invents a time — an item with no
 * arrival time was never given one, and guessing would put a vendor on
 * somebody's running order at an hour nobody agreed to.
 */
export function DaySchedule({ entries }: { entries: readonly ScheduleEntry[] }) {
  return (
    <GlassPanel className="p-5">
      <h3 className="m-0 mb-[14px] text-subhead">Day-of schedule</h3>

      {entries.length === 0 ? (
        <p className="m-0 text-[14px] text-pretty text-body">
          Nothing is timed yet. A start time on the event and an arrival time on each booking are
          what fill this in.
        </p>
      ) : (
        <Timeline
          entries={entries.map((entry) => ({ time: clock(entry.time), what: what(entry) }))}
        />
      )}
    </GlassPanel>
  );
}

/** `HH:MM:SS` as the database renders a `time`, read as a clock time. */
function clock(value: string): string {
  const [hours, minutes] = value.split(":");
  const hour = Number(hours);
  if (!Number.isFinite(hour)) return value;

  const meridiem = hour < 12 ? "AM" : "PM";
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}:${minutes ?? "00"} ${meridiem}`;
}

function what(entry: ScheduleEntry): string {
  return entry.kind === "venue"
    ? `Venue access · ${entry.venueName}`
    : // A slot can have an arrival time before it has a vendor: the time was set
      // when the service went into the plan, and the booking comes later.
      `${entry.categoryName} arrives${entry.vendorName ? ` · ${entry.vendorName}` : ""}`;
}
