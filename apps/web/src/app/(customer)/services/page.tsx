import Link from "next/link";
import {
  ANONYMOUS,
  formatMoney,
  listCategoriesForBrowse,
  listSaved,
  searchServices,
  type ServiceSearchFilter,
} from "@occasion/core";
import { EmptyState, PageHeader, Toast } from "@occasion/ui";
import { customerViewer } from "../../../lib/auth-guard";
import { createRequestContext } from "../../../lib/core";
import { ANY_AREA, SEARCH_AREAS, nameOf, readSearch, toSearchParams } from "../_config/search";
import { ServiceCard } from "../_components/service-card";
import { CategoryTabs, ResultFilters } from "./_components/result-filters";
import { ResultSort } from "./_components/result-sort";
import { QuoteNudge } from "./_components/quote-nudge";
import {
  BOOKING_MODES,
  PRICE_MAX_CENTS,
  PRICE_STEP_CENTS,
  SORT_CHOICES,
  TOP_RATED,
  hasNarrowingFilters,
  nextPageHref,
  readResultsQuery,
  sortInForce,
  withoutFilters,
} from "./results-query";

export const metadata = { title: "Services · Occasion" };

/** Rendered per request: the search is in the URL and the results follow it. */
export const dynamic = "force-dynamic";

/**
 * Results — **public**, and the screen the header's search submits to.
 *
 * No gate, by the prototype's own rule at line 2013, and named in the public
 * allowlist so that being public stays a decision somebody wrote down.
 *
 * The search lives in the URL and nowhere else. The pill renders from
 * `searchParams`, this page reads them back with the same reader, and the
 * filters push new ones — so a list is linkable, server-rendered, and cannot
 * show a narrowing the header beside it did not apply.
 *
 * **`when` is read and deliberately not applied.** The prototype's own
 * submission carries only the category (line 2190), and its "Available Mar N"
 * heading (line 2293) is a claim it never checks — every service is listed
 * whatever date is picked. Availability is a property of one service on one
 * date, and answering it over the whole anonymous catalogue would turn two
 * differenced queries into a list of which vendors a stranger whose event the
 * feed publishes has booked. It is answered on a service's own page instead.
 * It rides in the URL from here so it is still there when a listing is opened.
 *
 * Note for whoever changes the header: `searchToQuery` builds a fresh query
 * string, so submitting a new search clears the sort and the filters below.
 * That is defensible — a new search is a new search — but it is behaviour
 * nobody wrote down, and it belongs to that file rather than to this one.
 */
export default async function ServicesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = createRequestContext();
  const viewer = await customerViewer();
  // The catalogue is public and `ANONYMOUS` is a legal caller of every read
  // on this screen; the viewer only decides whose hearts are filled in.
  const actor = viewer ?? ANONYMOUS;

  const params = toSearchParams(await searchParams);
  const search = readSearch(params);

  const categories = await listCategoriesForBrowse(ctx, actor);
  const { filter, dropped } = readResultsQuery(
    params,
    categories.map((category) => category.slug),
  );

  const [page, saved] = await Promise.all([
    searchServices(ctx, actor, filter),
    viewer ? listSaved(ctx, viewer) : Promise.resolve([]),
  ]);

  const savedIds = new Set(saved.map((row) => row.id));
  const category = categories.find((row) => row.slug === filter.categorySlug);
  const area = nameOf(SEARCH_AREAS, search.where, ANY_AREA);

  return (
    <>
      <PageHeader
        title={category?.name ?? "Every service"}
        // No date in the summary, because no date was applied to this list.
        blurb={`${area}${search.guests == null ? "" : ` · ${search.guests} guests`}`}
      />

      {dropped.length > 0 ? (
        // Server-rendered, so no `onDismiss` and no client component: the
        // message is about this page's own URL and goes when the URL does.
        <Toast tone="warn" className="mb-[14px]">
          The address named a {dropped.join(", a ")} this screen does not offer, so the default is
          showing instead.
        </Toast>
      ) : null}

      <CategoryTabs
        categories={categories.map((row) => ({ slug: row.slug, name: row.name }))}
        active={filter.categorySlug}
      />

      <div className="mb-[8px] flex flex-wrap items-center justify-between gap-[12px]">
        <p className="m-0 text-[14px] text-body">
          <strong className="font-bold text-ink">{countLabel(page.rows.length, page)}</strong>
          {" · "}
          {area}
        </p>
        <ResultSort sort={sortInForce(filter)} choices={SORT_CHOICES} />
      </div>

      {/* The canvas puts the panel behind a Filters button (line 683). A
          disclosure does that without state; it starts open when something is
          already narrowing the list, so applying a filter does not shut the
          panel that applied it. */}
      <details open={hasNarrowingFilters(filter)} className="mb-[4px]">
        <summary className="oc-button oc-button--ghost oc-button--sm mb-[10px] w-fit cursor-pointer list-none">
          Filters
        </summary>
        <ResultFilters
          bookingMode={filter.bookingMode}
          modes={BOOKING_MODES}
          maxPrice={filter.maxPrice === undefined ? undefined : Number(filter.maxPrice)}
          priceLabels={priceLabels()}
          priceStep={PRICE_STEP_CENTS}
          topRated={filter.minRating !== undefined}
          topRatedValue={TOP_RATED}
        />
      </details>

      {page.rows.length === 0 ? (
        <Empty filter={filter} params={params} categoryName={category?.name} />
      ) : (
        <div className="grid gap-[18px] [grid-template-columns:repeat(auto-fill,minmax(230px,1fr))]">
          {page.rows.map((service) => (
            <ServiceCard
              key={service.id}
              service={service}
              saved={savedIds.has(service.id)}
              signedIn={viewer !== undefined}
            />
          ))}
        </div>
      )}

      {page.nextCursor ? (
        <div className="mt-4 flex justify-center">
          <Link
            href={nextPageHref(params, page.nextCursor)}
            className="oc-button oc-button--ghost oc-button--sm no-underline"
          >
            Next page
          </Link>
        </div>
      ) : null}

      <QuoteNudge />
    </>
  );
}

/**
 * The count line, line 681.
 *
 * "25 services" on a full page would be a claim about the catalogue that a
 * keyset page cannot make — there is no total, by design, because counting the
 * whole predicate on every page is the cost the cursor exists to avoid. So a
 * page that has a next one says so instead of naming a number that is wrong.
 */
function countLabel(shown: number, page: { nextCursor?: string | undefined }): string {
  if (page.nextCursor) return `${shown}+ services`;
  return `${shown} ${shown === 1 ? "service" : "services"}`;
}

/**
 * Two empty states, because they are two different situations.
 *
 * A category nobody has listed in yet is not a search that narrowed too far,
 * and offering to clear filters that were never applied is an action that does
 * nothing.
 */
function Empty({
  filter,
  params,
  categoryName,
}: {
  filter: ServiceSearchFilter;
  params: URLSearchParams;
  categoryName: string | undefined;
}) {
  if (hasNarrowingFilters(filter)) {
    return (
      <EmptyState
        title="No services match these filters"
        blurb="Nothing in this list meets all of them at once. Clearing them keeps the category and the area you chose."
        action={
          <Link
            href={withoutFilters(params)}
            className="oc-button oc-button--primary oc-button--md no-underline"
          >
            Clear filters
          </Link>
        }
      />
    );
  }

  return (
    <EmptyState
      title={categoryName ? `Nothing listed under ${categoryName} yet` : "Nothing listed yet"}
      blurb="Businesses are still joining this one. Browsing everything is the quickest way to see what is on offer."
      action={
        <Link href="/services" className="oc-button oc-button--primary oc-button--md no-underline">
          All services
        </Link>
      }
    />
  );
}

/**
 * One label per step of the price slider, formatted here.
 *
 * The control is a client component and may not import the domain as a value,
 * so the money it shows is formatted on this side of the boundary by the one
 * formatter in the repository. Twenty-one short strings, and no arithmetic on
 * a price anywhere near a component.
 */
function priceLabels(): string[] {
  const labels: string[] = [];
  for (let cents = 0; cents <= PRICE_MAX_CENTS; cents += PRICE_STEP_CENTS) {
    labels.push(`Up to ${formatMoney(BigInt(cents), "CAD")}`);
  }
  // The top of the range is no cap at all, not a cap nothing exceeds: a
  // listing priced above the slider must not vanish because somebody dragged
  // to the end. The slider starts at one step, so the zero label is never
  // drawn — a cap of nothing would match nothing.
  labels[labels.length - 1] = "Any price";
  return labels;
}
