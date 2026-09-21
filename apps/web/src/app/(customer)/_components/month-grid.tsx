"use client";

import { useState } from "react";
import { cx } from "@occasion/ui";

/**
 * A month of days, one selectable.
 *
 * Route-local, and it stays that way until a second screen asks for it. Its
 * only consumer in this plan is the search panel's When field; the calendar
 * screen that would be the second is not in this plan at all, and a component
 * promoted into the design system on one caller is a shared API nobody has
 * pressure-tested.
 *
 * Structure follows lines 338–353: seven columns of square cells with a 13px
 * radius, a row of day initials above, and the flexible-dates checkbox below.
 * Two things the prototype does not do are here because they are the
 * difference between a grid and a date picker — the cells are real dates
 * rather than 1…31 printed into a fixed 35-slot grid, and the month can be
 * changed.
 */

const DAY_INITIALS = ["S", "M", "T", "W", "T", "F", "S"] as const;

/** `YYYY-MM-DD` for a UTC date, which is the only form that leaves here. */
function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Midnight UTC on the first of the month a date falls in. */
function firstOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function addMonths(date: Date, count: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + count, 1));
}

/**
 * Everything is UTC, start to finish.
 *
 * A calendar day is not an instant, and reading one in the runtime's local
 * zone moves it: `new Date("2027-03-20")` is the 19th at 20:00 in Toronto, so
 * a grid built from local components would highlight the wrong cell and submit
 * the wrong day for anyone west of Greenwich.
 */
function monthCells(month: Date): Array<Date | null> {
  const start = month.getUTCDay();
  const days = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)).getUTCDate();

  return [
    ...Array.from({ length: start }, () => null),
    ...Array.from(
      { length: days },
      (_unused, index) =>
        new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), index + 1)),
    ),
  ];
}

export function MonthGrid({
  /** The selected day, `YYYY-MM-DD`, or nothing. */
  value,
  /** Today, from the server's clock — so a demo override moves this too. */
  today,
  onSelect,
  flexible,
  onFlexibleChange,
}: {
  value: string | undefined;
  today: string;
  onSelect: (next: string | undefined) => void;
  flexible: boolean;
  onFlexibleChange: (next: boolean) => void;
}) {
  const todayDate = new Date(`${today}T00:00:00Z`);
  const [month, setMonth] = useState(() =>
    firstOfMonth(value ? new Date(`${value}T00:00:00Z`) : todayDate),
  );

  const label = month.toLocaleDateString("en-CA", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  // An event in the past cannot be booked, so those days are not offered.
  const earliest = firstOfMonth(todayDate);
  const atEarliest = month.valueOf() <= earliest.valueOf();

  return (
    <div className="max-w-[400px]">
      <div className="mb-[11px] flex items-center justify-between gap-2">
        <p aria-live="polite" className="m-0 text-[14px] font-semibold">
          {label}
        </p>
        <span className="flex gap-1">
          <MonthStep
            label="Previous month"
            glyph="‹"
            disabled={atEarliest}
            onPress={() => setMonth(addMonths(month, -1))}
          />
          <MonthStep
            label="Next month"
            glyph="›"
            disabled={false}
            onPress={() => setMonth(addMonths(month, 1))}
          />
        </span>
      </div>

      {/* `aria-hidden`: each cell is named by its own full date, so reading
          seven initials first is noise with no navigation value. */}
      <div aria-hidden="true" className="mb-[5px] grid grid-cols-7 gap-[5px]">
        {DAY_INITIALS.map((initial, index) => (
          <p key={index} className="m-0 text-center text-[11px] font-bold text-body">
            {initial}
          </p>
        ))}
      </div>

      <div role="group" aria-label="Choose a date" className="grid grid-cols-7 gap-[5px]">
        {monthCells(month).map((date, index) => {
          if (!date) return <span key={`pad-${index}`} aria-hidden="true" />;

          const day = iso(date);
          const selected = day === value;
          const past = date.valueOf() < todayDate.valueOf();

          return (
            <button
              key={day}
              type="button"
              disabled={past}
              aria-pressed={selected}
              // The visible label is a bare number; on its own it says nothing.
              aria-label={date.toLocaleDateString("en-CA", {
                weekday: "long",
                month: "long",
                day: "numeric",
                year: "numeric",
                timeZone: "UTC",
              })}
              // Pressing the selected day clears it, which is the only way back
              // to "any date" once one is picked.
              onClick={() => onSelect(selected ? undefined : day)}
              className={cx(
                "aspect-square min-h-[40px] cursor-pointer rounded-tile border text-[13px] font-semibold",
                selected
                  ? "border-role bg-role text-surface"
                  : "border-glass-edge-soft bg-chip text-ink",
                past && "cursor-not-allowed opacity-[0.45]",
              )}
            >
              {date.getUTCDate()}
            </button>
          );
        })}
      </div>

      {/* Line 352. */}
      <label className="mt-3 flex cursor-pointer items-center gap-[9px] text-[13.5px] text-body">
        <input
          type="checkbox"
          className="oc-check"
          checked={flexible}
          onChange={(event) => onFlexibleChange(event.target.checked)}
        />
        My date is flexible by ±3 days
      </label>
    </div>
  );
}

function MonthStep({
  label,
  glyph,
  disabled,
  onPress,
}: {
  label: string;
  glyph: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onPress}
      className="size-[32px] cursor-pointer rounded-pill border border-glass-edge-soft bg-chip text-[15px] disabled:cursor-not-allowed disabled:opacity-[0.55]"
    >
      <span aria-hidden="true">{glyph}</span>
    </button>
  );
}
