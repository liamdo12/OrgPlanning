import { and, asc, desc, eq, exists, gte, isNotNull, lte, sql } from "drizzle-orm";
import {
  categories,
  neighbourhoods,
  serviceAreas,
  serviceMedia,
  services,
  vendors,
} from "@occasion/db/schema";
import type { CoreContext, DbExecutor } from "../context.js";
import type { Actor } from "../identity/actor.js";
import { PAGE_SIZE, SORTS, decodeCursor, encodeCursor, type Sort } from "../paging.js";

/**
 * The results screen's query.
 *
 * Everything that narrows the list is in the `where`, including the two
 * conditions the caller never asked for: the vendor must be approved and the
 * listing must be published. A row dropped after the query is a row that
 * reached the caller, and a caller that receives one will eventually forget to
 * drop it — but the stronger reason is paging. A page is twenty-five rows *as
 * the database counted them*, so filtering afterwards returns short pages,
 * empty pages in front of full ones, and a cursor that skips whatever the
 * filter removed.
 *
 * **There is no date filter, and its absence is deliberate.** The signed-out
 * feed already publishes a stranger's event date and neighbourhood. Add
 * "free on this date" to an anonymous results query answered from
 * `capacity_blocks` and two queries differenced recover exactly which vendors
 * that stranger booked — with the feed's own "6 services booked" as a checksum.
 * Free-on-a-date is answered on one service's own page, where the question is
 * about one business the asker has already named. `search.test.ts` asserts the
 * filter type has no such field.
 */

/** Pictures per card. The results carousel shows three; more is bytes nobody draws. */
const MEDIA_PER_CARD = 3;

export type ServiceCardMedia = {
  url: string;
  altText: string | null;
};

export type ServiceCard = {
  id: string;
  slug: string;
  title: string;
  vendorId: string;
  vendorName: string;
  categorySlug: string;
  categoryName: string;
  basePrice: bigint;
  currency: string;
  priceUnit: string;
  bookingMode: string;
  badge: string | null;
  areaLabel: string | null;
  ratingAverage: number;
  reviewCount: number;
  toneStart: string | null;
  toneEnd: string | null;
  /** At most `MEDIA_PER_CARD`, ordered as the vendor arranged them. */
  media: ServiceCardMedia[];
  /**
   * The database's own rendering of whichever column this sort leads on.
   *
   * Text rather than the typed value beside it, for the reason `paging.ts`
   * gives: the cursor is compared against the column, and a value that went
   * through a JavaScript number would name a rating or a price no row holds.
   */
  cursorAt: string;
};

/**
 * The three orders the results screen offers.
 *
 * Three genuinely different queries rather than three labels: collapsing
 * "recommended" onto the rating would make two of them the same list. The
 * prototype sorts for price and rating and applies no order at all for
 * recommended, so "most reviewed first" is ours — and it has to be *something*
 * total, because a keyset page over a non-total order repeats or skips rows.
 */
export type ServiceSort = "recommended" | "rating" | "price_low_to_high";

type SortPlan = {
  sort: Sort;
  /** The leading column, which is also the first member of the cursor. */
  column: typeof services.reviewCount | typeof services.ratingAverage | typeof services.basePrice;
  descending: boolean;
  /**
   * The partial index that satisfies both the filter and the ordering.
   *
   * Named here rather than left implicit because an index is only load-bearing
   * while the planner picks it, and nothing about a correct answer says which
   * one it used. `performance.test.ts` runs `explain` against each of these.
   */
  index: string;
};

export const SERVICE_SORTS = {
  recommended: {
    sort: SORTS.servicesRecommended,
    column: services.reviewCount,
    descending: true,
    index: "services_reviews_idx",
  },
  rating: {
    sort: SORTS.servicesRating,
    column: services.ratingAverage,
    descending: true,
    index: "services_rating_idx",
  },
  price_low_to_high: {
    sort: SORTS.servicesPriceLowest,
    column: services.basePrice,
    descending: false,
    index: "services_price_idx",
  },
} as const satisfies Record<ServiceSort, SortPlan>;

export const DEFAULT_SERVICE_SORT: ServiceSort = "recommended";

/**
 * What a customer may narrow the catalogue by.
 *
 * Slugs rather than ids, because these arrive from a public URL and a slug is
 * what that URL already carries. It also means nothing here names an entity the
 * caller had to be told about.
 */
export type ServiceSearchFilter = {
  categorySlug?: string | undefined;
  neighbourhoodSlug?: string | undefined;
  bookingMode?: "book_now" | "quote" | undefined;
  /** Inclusive cap, in cents. */
  maxPrice?: bigint | undefined;
  /** Inclusive floor, e.g. 4.8 for the prototype's "top rated" chip. */
  minRating?: number | undefined;
  sort?: ServiceSort | undefined;
  /** The last row of the previous page. See `paging.ts`. */
  cursor?: string | undefined;
};

/**
 * Every way the anonymous catalogue can be narrowed, as a value.
 *
 * `Record<keyof ServiceSearchFilter, true>` is the tie: a field added to the
 * type above and not to this object does not compile, and neither does a name
 * here that the type does not have. That is what turns "there is no date
 * filter" from a sentence in a comment into something a test can read — see
 * `search.test.ts`, which refuses a date-shaped name in this list.
 */
const FILTERS: Record<keyof ServiceSearchFilter, true> = {
  categorySlug: true,
  neighbourhoodSlug: true,
  bookingMode: true,
  maxPrice: true,
  minRating: true,
  sort: true,
  cursor: true,
};

export const SEARCH_FILTER_FIELDS: readonly string[] = Object.keys(FILTERS);

export type ServicePage = {
  rows: ServiceCard[];
  /** Present when there is another page; absent when this is the last. */
  nextCursor?: string | undefined;
};

/**
 * Up to three pictures, aggregated in the same query as the cards.
 *
 * `LATERAL` rather than a grouped subquery over the whole table: a grouped one
 * is computed for every service that has ever had a picture before anything is
 * joined, which stops the planner pushing the page's cursor into the driving
 * scan and costs the whole table per page. A lateral runs once per row the scan
 * actually keeps.
 *
 * The limit is inside, so the aggregate never sees more than three rows — a
 * vendor with forty pictures costs the same as one with two.
 */
function mediaFor(db: DbExecutor) {
  const topOfTheCard = db
    .select({
      url: serviceMedia.url,
      altText: serviceMedia.altText,
      sortOrder: serviceMedia.sortOrder,
    })
    .from(serviceMedia)
    .where(eq(serviceMedia.serviceId, services.id))
    .orderBy(asc(serviceMedia.sortOrder))
    .limit(MEDIA_PER_CARD)
    .as("card_media");

  return db
    .select({
      items: sql<ServiceCardMedia[]>`coalesce(
        json_agg(
          json_build_object('url', ${topOfTheCard.url}, 'altText', ${topOfTheCard.altText})
          order by ${topOfTheCard.sortOrder}
        ),
        '[]'::json
      )`.as("items"),
    })
    .from(topOfTheCard)
    .as("card_media_agg");
}

/**
 * The results query, exactly as `searchServices` runs it.
 *
 * Exported so `performance.test.ts` can `explain` the shipped query rather than
 * a copy of it. A plan assertion written against a second expression of the
 * same idea proves that expression uses an index, which is not the claim.
 */
export function searchServicesQuery(db: DbExecutor, filter: ServiceSearchFilter = {}) {
  const plan = SERVICE_SORTS[filter.sort ?? DEFAULT_SERVICE_SORT];
  const after = filter.cursor ? decodeCursor(plan.sort, filter.cursor) : undefined;
  const media = mediaFor(db);

  const conditions = [
    eq(vendors.status, "approved"),
    isNotNull(services.publishedAt),
    ...(filter.categorySlug ? [eq(categories.slug, filter.categorySlug)] : []),
    ...(filter.bookingMode ? [eq(services.bookingMode, filter.bookingMode)] : []),
    ...(filter.maxPrice !== undefined ? [lte(services.basePrice, filter.maxPrice)] : []),
    ...(filter.minRating !== undefined
      ? [gte(services.ratingAverage, String(filter.minRating))]
      : []),
    // `exists` rather than a join: a service serving four neighbourhoods would
    // otherwise appear four times, and a page of twenty-five would hold fewer
    // than twenty-five listings.
    ...(filter.neighbourhoodSlug
      ? [
          exists(
            db
              .select({ one: sql`1` })
              .from(serviceAreas)
              .innerJoin(neighbourhoods, eq(neighbourhoods.id, serviceAreas.neighbourhoodId))
              .where(
                and(
                  eq(serviceAreas.serviceId, services.id),
                  eq(neighbourhoods.slug, filter.neighbourhoodSlug),
                ),
              ),
          ),
        ]
      : []),
    // A row comparison rather than two branches joined by `or`: one expression
    // with the same meaning and no way to get the tiebreak's polarity wrong.
    // Both members run the sort's own direction, which is what lets the partial
    // index satisfy the page without a sort.
    ...(after
      ? [
          plan.descending
            ? sql`(${plan.column}, ${services.id}) < (${after.value}::numeric, ${after.id}::uuid)`
            : sql`(${plan.column}, ${services.id}) > (${after.value}::numeric, ${after.id}::uuid)`,
        ]
      : []),
  ];

  return (
    db
      .select({
        id: services.id,
        slug: services.slug,
        title: services.title,
        vendorId: vendors.id,
        vendorName: vendors.name,
        categorySlug: categories.slug,
        categoryName: categories.name,
        basePrice: services.basePrice,
        currency: services.currency,
        priceUnit: services.priceUnit,
        bookingMode: services.bookingMode,
        badge: services.badge,
        areaLabel: services.areaLabel,
        ratingAverage: sql<number>`${services.ratingAverage}::float8`.mapWith(Number),
        reviewCount: services.reviewCount,
        toneStart: services.toneStart,
        toneEnd: services.toneEnd,
        media: media.items,
        cursorAt: sql<string>`${plan.column}::text`,
      })
      .from(services)
      .innerJoin(vendors, eq(vendors.id, services.vendorId))
      .innerJoin(categories, eq(categories.id, services.categoryId))
      .leftJoinLateral(media, sql`true`)
      .where(and(...conditions))
      .orderBy(
        plan.descending ? desc(plan.column) : asc(plan.column),
        plan.descending ? desc(services.id) : asc(services.id),
      )
      // One more than a page, so "is there another page" is answered by what came
      // back rather than by a second count over the same predicate.
      .limit(PAGE_SIZE + 1)
  );
}

/**
 * What the results screen shows.
 *
 * Takes an actor it does not consult: the catalogue is public, `ANONYMOUS` is a
 * legal caller, and an export with no actor parameter is invisible to the
 * suites that check every way into a row goes past a gate.
 */
export async function searchServices(
  ctx: CoreContext,
  _actor: Actor,
  filter: ServiceSearchFilter = {},
): Promise<ServicePage> {
  const plan = SERVICE_SORTS[filter.sort ?? DEFAULT_SERVICE_SORT];
  const found = (await searchServicesQuery(ctx.db, filter)) as ServiceCard[];

  const page = found.slice(0, PAGE_SIZE);
  const last = page[page.length - 1];

  return {
    rows: page,
    ...(found.length > PAGE_SIZE && last
      ? { nextCursor: encodeCursor(plan.sort, { value: last.cursorAt, id: last.id }) }
      : {}),
  };
}
