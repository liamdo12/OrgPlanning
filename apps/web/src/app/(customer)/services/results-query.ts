import { DEFAULT_SERVICE_SORT, type ServiceSearchFilter, type ServiceSort } from "@occasion/core";
import type { ReadableParams } from "../_config/search";

/**
 * The results screen's URL, read and written in one place.
 *
 * Every narrowing the catalogue offers is a query parameter and nothing is
 * component state, so a filtered list survives a reload, can be sent to
 * somebody else, and is rendered on the server with the filter already
 * applied. The controls are thin: they build one of these and push it.
 *
 * **There is no date here, and its absence is the point.** The signed-out feed
 * already publishes a stranger's event date and neighbourhood; an anonymous
 * "free on this date" answered from held capacity would let two queries
 * differenced recover which vendors that stranger booked. The domain's filter
 * type has no such field and `search.test.ts` asserts it; this reader has no
 * way to name one either, which is what keeps the two halves from drifting.
 *
 * A value that is not understood is **dropped and named**, rather than passed
 * to the query or silently ignored: the screen then renders defaults and says
 * which control it disregarded.
 */

/** The three orders offered, as values, so the sort control and the reader agree. */
export const SORT_CHOICES: ReadonlyArray<{ value: ServiceSort; label: string }> = [
  { value: "recommended", label: "Sort: Recommended" },
  { value: "price_low_to_high", label: "Sort: Price low to high" },
  { value: "rating", label: "Sort: Rating" },
];

/** The canvas's one rating chip, line 708. */
export const TOP_RATED = 4.8;

/**
 * The price slider's bounds, **in cents**, because that is what the catalogue
 * stores and what the filter takes. Carrying dollars in the URL would put a
 * multiplication between the control and the query for no gain.
 */
export const PRICE_MAX_CENTS = 100_000;
export const PRICE_STEP_CENTS = 5_000;

export const BOOKING_MODES: ReadonlyArray<{ value: "book_now" | "quote"; label: string }> = [
  { value: "book_now", label: "Book now" },
  { value: "quote", label: "Request a quote" },
];

export type ResultsQuery = {
  filter: ServiceSearchFilter;
  /**
   * Controls whose value the URL named and this reader did not understand.
   *
   * The screen renders with defaults and says so. Silently correcting a URL
   * somebody shared is how a person ends up looking at a different list from
   * the one they were sent.
   */
  dropped: string[];
};

/**
 * Reads the narrowing parameters.
 *
 * `categories` is the domain's own list of browsable slugs, passed in rather
 * than imported: the interim list in `_config/search.ts` is a transcription of
 * the prototype, and a category present in one and not the other would turn a
 * legitimate tab into a dropped parameter.
 */
export function readResultsQuery(
  params: ReadableParams,
  categories: readonly string[],
): ResultsQuery {
  const dropped: string[] = [];
  const one = (key: string) => params.get(key)?.trim() || undefined;

  const category = one("cat");
  const mode = one("mode");
  const max = one("max");
  const rating = one("rating");
  const sort = one("sort");
  const cursor = one("cursor");
  const neighbourhood = one("where");

  const filter: ServiceSearchFilter = {};

  if (category !== undefined) {
    if (categories.includes(category)) filter.categorySlug = category;
    else dropped.push("category");
  }

  // Not checked against a list: the header's own reader already bounds it, and
  // an unknown slug simply matches nothing — which the empty state answers.
  if (neighbourhood !== undefined) filter.neighbourhoodSlug = neighbourhood;

  if (mode !== undefined) {
    if (mode === "book_now" || mode === "quote") filter.bookingMode = mode;
    else dropped.push("booking mode");
  }

  if (max !== undefined) {
    // Digits only: `Number.parseInt` would read "50000; drop table" as 50000,
    // and the value goes into a comparison against a money column.
    const cents = /^\d+$/.test(max) ? Number(max) : Number.NaN;
    if (Number.isInteger(cents) && cents > 0 && cents <= PRICE_MAX_CENTS) {
      filter.maxPrice = BigInt(cents);
    } else {
      dropped.push("maximum price");
    }
  }

  if (rating !== undefined) {
    if (rating === String(TOP_RATED)) filter.minRating = TOP_RATED;
    else dropped.push("rating");
  }

  if (sort !== undefined) {
    const known = SORT_CHOICES.find((choice) => choice.value === sort);
    if (known) filter.sort = known.value;
    else dropped.push("sort order");
  }

  // Passed through unchecked, and deliberately absent from `dropped`. The
  // domain's decoder answers the first page for anything it does not
  // recognise, which is the right answer for a cursor somebody edited — and
  // telling them a control was disregarded would name one they never touched.
  if (cursor !== undefined) filter.cursor = cursor;

  return { filter, dropped };
}

/** The sort in force, which is the default until somebody chooses otherwise. */
export function sortInForce(filter: ServiceSearchFilter): ServiceSort {
  return filter.sort ?? DEFAULT_SERVICE_SORT;
}

/** Whether anything beyond the category and area is narrowing the list. */
export function hasNarrowingFilters(filter: ServiceSearchFilter): boolean {
  return (
    filter.bookingMode !== undefined ||
    filter.maxPrice !== undefined ||
    filter.minRating !== undefined
  );
}

/**
 * The address of the next page: this URL with the cursor replaced.
 *
 * Everything else is carried, because a cursor is only meaningful against the
 * filter and sort that produced it — a link that dropped them would page
 * through a different list from the one being read.
 */
export function nextPageHref(params: ReadableParams & Iterable<[string, string]>, cursor: string) {
  const next = new URLSearchParams(Array.from(params));
  next.set("cursor", cursor);
  return `/services?${next.toString()}`;
}

/**
 * The address with the narrowing filters removed and the place kept.
 *
 * What "clear filters" means: the person still asked for florists in Liberty
 * Village, and returning them to the whole catalogue would answer a question
 * they did not ask. The cursor goes too — it names a row in the old list.
 */
export function withoutFilters(params: ReadableParams & Iterable<[string, string]>) {
  const next = new URLSearchParams(Array.from(params));
  for (const key of ["mode", "max", "rating", "cursor"]) next.delete(key);
  const query = next.toString();
  return query ? `/services?${query}` : "/services";
}
