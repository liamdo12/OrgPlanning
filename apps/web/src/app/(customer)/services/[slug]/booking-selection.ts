import type { ReadableParams } from "../../_config/search";

/**
 * What the booking card has been asked for, read from the URL.
 *
 * The package, the quantity and the arrival time are query parameters for the
 * same reason the results filters are: the five money figures are computed on
 * the server by the one function that prices a checkout, so the selection has
 * to reach the server. Holding it in component state would mean either a
 * second pricing path in the browser or a deposit that does not follow the
 * package somebody just picked.
 *
 * Every value is checked against what this listing actually offers. A package
 * id from another service, a quantity of zero and an arrival time nobody
 * offered all fall back to the default rather than reaching the domain.
 */

export type BookingSelection = {
  servicePackageId: string | null;
  quantity: number;
  /** `HH:MM`, or null when the event has no start time to offer one against. */
  arrivalTime: string | null;
};

/** One booking, not a wholesale order. The stepper's ceiling is the same number. */
export const MAX_QUANTITY = 50;

/**
 * Around the event's own start. Lines 834–836 offer three half-hours; here
 * they are derived from the event rather than fixed at the canvas's 5pm.
 */
const ARRIVAL_OFFSETS_MINUTES = [-30, 0, 30];

const MINUTES_IN_A_DAY = 24 * 60;

export type ArrivalOption = { value: string; label: string };

/**
 * The arrival times this event can offer.
 *
 * Empty when the event has no start time: an event whose hour nobody has set
 * cannot say when a caterer should arrive, and three invented times would be
 * a promise made on the vendor's behalf.
 */
export function arrivalOptions(startTime: string | null): ArrivalOption[] {
  const startsAt = minutesOf(startTime);
  if (startsAt === null) return [];

  return ARRIVAL_OFFSETS_MINUTES.map((offset) => startsAt + offset)
    .filter((at) => at >= 0 && at < MINUTES_IN_A_DAY)
    .map((at) => ({ value: clockOf(at), label: labelOf(at) }));
}

export function readBookingSelection(
  params: ReadableParams,
  offered: {
    packageIds: readonly string[];
    arrivals: readonly ArrivalOption[];
  },
): BookingSelection {
  const one = (key: string) => params.get(key)?.trim() || undefined;

  const requested = one("pkg");
  const quantity = one("qty");
  const arrival = one("arrive");

  const parsed = quantity !== undefined && /^\d+$/.test(quantity) ? Number(quantity) : Number.NaN;

  return {
    // The first package is the default, because a listing that has them is
    // priced as one of them — the base price is what a listing with none is
    // sold at, and offering it beside three tiers would be a fourth option.
    servicePackageId:
      requested !== undefined && offered.packageIds.includes(requested)
        ? requested
        : (offered.packageIds[0] ?? null),
    quantity: Number.isInteger(parsed) && parsed >= 1 && parsed <= MAX_QUANTITY ? parsed : 1,
    arrivalTime:
      arrival !== undefined && offered.arrivals.some((option) => option.value === arrival)
        ? arrival
        : (offered.arrivals[1]?.value ?? offered.arrivals[0]?.value ?? null),
  };
}

/** This page's address with one part of the selection changed. */
export function selectionHref(
  slug: string,
  params: ReadableParams & Iterable<[string, string]>,
  change: Record<string, string>,
): string {
  const next = new URLSearchParams(Array.from(params));
  for (const [key, value] of Object.entries(change)) next.set(key, value);
  const query = next.toString();
  return query ? `/services/${slug}?${query}` : `/services/${slug}`;
}

/** `HH:MM` as minutes past midnight, or null for anything that is not one. */
function minutesOf(clock: string | null): number | null {
  if (!clock) return null;
  const match = /^(\d{2}):(\d{2})/.exec(clock);
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;

  return hours * 60 + minutes;
}

function clockOf(at: number): string {
  const hours = Math.floor(at / 60);
  const minutes = at % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/**
 * "4:30 PM", as the canvas writes it (line 834).
 *
 * Built rather than formatted through `Intl`: a time of day is not an instant,
 * and turning one into a `Date` to render it invents a calendar day and a zone
 * that the value does not have. `en-CA` would also render "p.m." here, which
 * is the full stop the instant formatter already works around.
 */
function labelOf(at: number): string {
  const hours = Math.floor(at / 60);
  const minutes = at % 60;
  const hour = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour}:${String(minutes).padStart(2, "0")} ${hours < 12 ? "AM" : "PM"}`;
}
