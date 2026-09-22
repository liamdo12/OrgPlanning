/**
 * An instant, in Toronto, that does not end in a full stop.
 *
 * `en-CA` renders the meridiem as `p.m.`, so a formatted time at the end of a
 * sentence produces `4:06 p.m..` — which reads as a typo on a screen whose
 * whole job is to be precise about time. Shortening it to `pm` is the smallest
 * fix that keeps the locale's own date format.
 */
const format = new Intl.DateTimeFormat("en-CA", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "America/Toronto",
});

export function formatMoment(at: Date): string {
  return format.format(at).replace("a.m.", "am").replace("p.m.", "pm");
}

/**
 * A day with no time on it, which is a different thing and needs saying twice.
 *
 * "Balance on Mar 6, 2027" (line 846) is a date the customer will recognise on
 * a statement; the hour the charge happens to run at is noise beside it. The
 * year is there because these are event dates, often more than a year out.
 */
const day = new Intl.DateTimeFormat("en-CA", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "America/Toronto",
});

/** The Toronto day an instant falls on. */
export function formatDay(at: Date): string {
  return day.format(at);
}

/**
 * A calendar day, `YYYY-MM-DD`, as it is written.
 *
 * Parsed as UTC deliberately: an event date is a day on a calendar, not an
 * instant, and letting the runtime read it in the local zone moves it back by
 * one anywhere west of Greenwich — which is every zone this product runs in.
 */
export function formatCalendarDay(iso: string): string {
  const parsed = new Date(`${iso}T12:00:00Z`);
  return Number.isNaN(parsed.valueOf())
    ? iso
    : new Intl.DateTimeFormat("en-CA", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      }).format(parsed);
}
