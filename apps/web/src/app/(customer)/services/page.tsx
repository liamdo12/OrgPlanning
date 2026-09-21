import { EmptyState, PageHeader } from "@occasion/ui";
import {
  ANY_AREA,
  ANY_CATEGORY,
  SEARCH_AREAS,
  SEARCH_CATEGORIES,
  nameOf,
  readSearch,
  toSearchParams,
} from "../_config/search";

export const metadata = { title: "Services · Occasion" };

/** Rendered per request: the search is in the URL and the results follow it. */
export const dynamic = "force-dynamic";

/**
 * Results — **public**, and the screen the header's search submits to.
 *
 * No gate, by the same rule as Explore (line 2013), and named in the public
 * allowlist so that being public stays a decision somebody wrote down.
 *
 * The listings arrive with the catalogue read. What this screen already does is
 * the part the shell depends on: the search lives in the URL, is read back with
 * the same reader the header's pill uses, and survives a reload — so the pill
 * can never show a filter this page did not apply.
 *
 * **`when` is read and deliberately not applied here.** The prototype's own
 * submission carries only the category (line 2190), and its "Available Mar N"
 * results heading (line 2293) is a claim it never checks — every service is
 * listed whatever date is selected. Availability is a property of one service
 * on one date, so the date belongs on the service's own screen, where it can be
 * answered honestly. It rides in the URL from here so that it is still there
 * when somebody opens a listing.
 */
export default async function ServicesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const search = readSearch(toSearchParams(await searchParams));

  const category = nameOf(SEARCH_CATEGORIES, search.cat, ANY_CATEGORY);
  const area = nameOf(SEARCH_AREAS, search.where, ANY_AREA);

  return (
    <>
      <PageHeader
        title={search.cat ? category : "Every service"}
        // No date in the summary, because no date was applied to this list.
        blurb={`${area}${search.guests == null ? "" : ` · ${search.guests} guests`}`}
      />

      <EmptyState
        title="Listings arrive with the catalogue"
        blurb="The search above is real and is carried in the address bar, so this page can be linked, shared and reloaded. What it cannot do yet is show you services."
      />
    </>
  );
}
