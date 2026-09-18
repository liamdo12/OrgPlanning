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
