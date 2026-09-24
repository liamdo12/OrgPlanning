/**
 * What the header's search panel offers, and how a search rides in a URL.
 *
 * The lists below are transcribed from the prototype and carry the slugs the
 * seed writes, so a submitted search names rows that exist. They are **an
 * interim source**: the catalogue read that serves the results screen will
 * serve this panel too, and this file goes when it lands. Until then a read
 * from `apps/web/src/lib` straight to the database would be the second
 * data-access path the layering exists to prevent.
 *
 * The search itself lives in the URL and nowhere else. The pill renders from
 * `searchParams`, the panel opens with those values and submits new ones, and
 * the results screen reads them — so a search is linkable, server-rendered,
 * and cannot show a value the page beside it did not apply.
 */

export type SearchChoice = { slug: string; name: string };

/**
 * Source: `cats()`, lines 1967–1973, minus `all` — which is a filter and not a
 * category, and is expressed here by the absence of `cat` from the URL.
 *
 * The slugs match `packages/db/src/seed/data/reference.ts`, which transcribes
 * the same lines. They have to: they are what `?cat=` names.
 */
export const SEARCH_CATEGORIES: readonly SearchChoice[] = [
  { slug: "flowers", name: "Flowers" },
  { slug: "catering", name: "Catering" },
  { slug: "cakes", name: "Cakes" },
  { slug: "photography", name: "Photography" },
  { slug: "entertainment", name: "Entertainment" },
  { slug: "decorations", name: "Decorations" },
];

/** Source: `whereOptions`, line 2200 — the prototype's own "Popular areas". */
export const SEARCH_AREAS: readonly SearchChoice[] = [
  { slug: "liberty-village", name: "Liberty Village" },
  { slug: "downtown-core", name: "Downtown core" },
  { slug: "midtown", name: "Midtown" },
  { slug: "north-york", name: "North York" },
  { slug: "east-end", name: "East End" },
  { slug: "west-end", name: "West End" },
  { slug: "etobicoke", name: "Etobicoke" },
];

/** Source: `guestPresets`, line 2231. */
export const GUEST_PRESETS: readonly number[] = [20, 60, 120, 200];

/** Source: the stepper's own clamps, lines 2229–2230. */
export const GUESTS_MIN = 5;
export const GUESTS_MAX = 500;
export const GUESTS_STEP = 5;

/** What the pill shows when a field has no selection. Line 2188. */
export const ANY_CATEGORY = "Any service";
export const ANY_AREA = "All of Toronto";

/** A search, as the URL carries it. Every field is optional. */
export type SearchSelection = {
  cat?: string | undefined;
  where?: string | undefined;
  /** An ISO date, `YYYY-MM-DD`. */
  when?: string | undefined;
  guests?: number | undefined;
  /** The prototype's ±3 days, line 351. */
  flex?: boolean | undefined;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Just enough of `URLSearchParams` to read one.
 *
 * Structural, so the server's `searchParams` and the client's
 * `useSearchParams()` go through the same reader. Two readers is two sets of
 * rules about which values are acceptable, and the pill and the page would
 * eventually disagree about a URL they are both looking at.
 */
export type ReadableParams = { get(name: string): string | null };

/** Next hands a record on the server; this is it as something readable. */
export function toSearchParams(
  record: Record<string, string | string[] | undefined>,
): URLSearchParams {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(record)) {
    // An array means the parameter repeated. The last one wins, which is what
    // a browser does with a form submitted twice.
    const found = Array.isArray(value) ? value[value.length - 1] : value;
    if (found !== undefined) params.set(key, found);
  }

  return params;
}

/**
 * The selection a URL names, with anything unrecognised dropped.
 *
 * Every value is checked against the list it came from rather than passed
 * through: these reach a query and a heading, and an unchecked one is both a
 * filter nobody offered and a string on the page.
 */
export function readSearch(params: ReadableParams): SearchSelection {
  const one = (key: string) => params.get(key)?.trim() || undefined;

  const cat = one("cat");
  const where = one("where");
  const when = one("when");
  const guests = Number.parseInt(one("guests") ?? "", 10);

  return {
    ...(SEARCH_CATEGORIES.some((item) => item.slug === cat) ? { cat } : {}),
    ...(SEARCH_AREAS.some((item) => item.slug === where) ? { where } : {}),
    // A real date, not the prototype's day-of-month: `when` outlives the panel
    // it was picked in and has to mean something on its own.
    ...(when && ISO_DATE.test(when) && !Number.isNaN(Date.parse(when)) ? { when } : {}),
    ...(Number.isFinite(guests) && guests >= GUESTS_MIN && guests <= GUESTS_MAX ? { guests } : {}),
    ...(one("flex") === "1" ? { flex: true } : {}),
  };
}

/** The same selection as a query string, with empty fields left out. */
export function searchToQuery(selection: SearchSelection): string {
  const query = new URLSearchParams();

  if (selection.cat) query.set("cat", selection.cat);
  if (selection.where) query.set("where", selection.where);
  if (selection.when) query.set("when", selection.when);
  if (selection.guests != null) query.set("guests", String(selection.guests));
  if (selection.flex) query.set("flex", "1");

  const rendered = query.toString();
  return rendered ? `?${rendered}` : "";
}

export function nameOf(list: readonly SearchChoice[], slug: string | undefined, fallback: string) {
  return list.find((item) => item.slug === slug)?.name ?? fallback;
}

/**
 * The date, as the pill shows it. Line 2180 renders "Mar 20".
 *
 * Parsed as UTC deliberately: an ISO date is a calendar day, and letting the
 * runtime read it in the local zone shifts it by one west of Greenwich.
 */
export function formatSearchDate(iso: string | undefined): string {
  if (!iso) return "Any date";
  const parsed = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(parsed.valueOf())
    ? "Any date"
    : parsed.toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: "UTC" });
}
