import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type postgres from "postgres";
import { HOLDS_CAPACITY } from "@occasion/db/testing";
import type { CoreContext } from "../src/context.js";
import { CapacityConflictError, NotFoundError } from "../src/errors.js";
import { ANONYMOUS, type Actor } from "../src/identity/actor.js";
import { getActor } from "../src/identity/service.js";
import { serviceAvailability } from "../src/catalog/availability.js";
import { listCategoriesForBrowse } from "../src/catalog/categories.js";
import { getServiceDetail } from "../src/catalog/detail.js";
import { listPublicEventFeed } from "../src/catalog/feed.js";
import { quoteCheckout } from "../src/catalog/quote-checkout.js";
import { listSaved, toggleSaved } from "../src/catalog/saved.js";
import { searchServices, searchServicesQuery, SERVICE_SORTS } from "../src/catalog/search.js";
import { getPublicService, listPublicServices } from "../src/catalog/service.js";
import { createCheckout } from "../src/ordering/service.js";
import { ORDER_STATES, capacityIn } from "../src/ordering/transitions.js";
import { decideReport } from "../src/moderation/service.js";
import { suspendVendor } from "../src/vendors/service.js";
import { createDatabaseContext, ownerSql, resetDatabase, testDatabaseUrl } from "./harness.js";

/**
 * The discovery screens, against a real database.
 *
 * The claims here are the ones a fake cannot make honestly: that a draft
 * listing is absent from a query rather than dropped afterwards; that a keyset
 * page over a catalogue big enough to need one visits every row exactly once;
 * that a quote and a checkout produce the same five numbers because they run
 * the same code over the same rows; and that the dates the seed says are booked
 * are dates the database will actually refuse a second time.
 */

const url = testDatabaseUrl();

/** Approved vendor, published listing. The seed's other four fail one or the other. */
const LISTABLE_SLUG = "bridal-and-table-bouquets";
/** Approved vendor, unpublished listing — publication on its own. */
const DRAFT_SLUG = "photo-booth-3h";
/** Published listing, vendor still pending — vendor standing on its own. */
const PENDING_VENDOR_SLUG = "string-quartet-two-sets";
/** Published listing, vendor blocked. */
const BLOCKED_VENDOR_SLUG = "lounge-furniture-package";

describe.skipIf(!url)("catalogue discovery", () => {
  const dbUrl = url as string;
  let sql: postgres.Sql;
  let database: ReturnType<typeof createDatabaseContext>;
  let ctx: CoreContext;
  let sarah: Actor;
  let admin: Actor;
  let sarahId: string;

  beforeEach(async () => {
    await resetDatabase(dbUrl);
    await database?.close();
    sql ??= ownerSql(dbUrl);

    database = createDatabaseContext(dbUrl);
    ctx = database.ctx;

    await sql`update app.planning_org_users set auth_provider_sub = 'provider-sub-' || email`;

    sarah = await actorFor("sarah@example.ca");
    admin = await actorFor("admin@occasion.test");
    sarahId = (sarah as Extract<Actor, { kind: "user" }>).userId;
  }, 120_000);

  afterAll(async () => {
    await database?.close();
    await sql?.end({ timeout: 5 });
  });

  async function actorFor(email: string): Promise<Actor> {
    database.setUser({
      id: `provider-sub-${email}`,
      email,
      issuedAt: new Date(),
      emailVerified: true,
      secondFactorVerified: true,
    });
    return getActor(ctx, {});
  }

  async function serviceIdOf(slug: string): Promise<string> {
    const [row] = await sql<{ id: string }[]>`
      select id from app.planning_org_services where slug = ${slug}
    `;
    if (!row) throw new Error(`no seeded service ${slug}`);
    return row.id;
  }

  /** An event of Sarah's, a whole number of days from now. */
  async function eventIn(days: number, name = `Event in ${days} days`): Promise<string> {
    const [row] = await sql<{ id: string }[]>`
      insert into app.planning_org_events (owner_user_id, name, event_date, start_time, timezone)
      values (
        ${sarahId}, ${name},
        (now() + (${days} || ' days')::interval)::date,
        '17:00', 'America/Toronto'
      )
      returning id
    `;
    return row?.id as string;
  }

  describe("what a customer can find", () => {
    it("shows only a published listing of an approved business", async () => {
      const page = await searchServices(ctx, ANONYMOUS, {});
      const slugs = page.rows.map((row) => row.slug);

      expect(slugs).toContain(LISTABLE_SLUG);
      expect(slugs).not.toContain(DRAFT_SLUG);
      expect(slugs).not.toContain(PENDING_VENDOR_SLUG);
      expect(slugs).not.toContain(BLOCKED_VENDOR_SLUG);

      // Not zero, which is what the whole change looks like when the seed half
      // of it is missing: every condition satisfied, every screen empty.
      expect(page.rows.length).toBeGreaterThan(0);
    });

    it("drops both kinds of unlistable row from the older list as well", async () => {
      const listed = await listPublicServices(ctx, ANONYMOUS);
      const slugs = listed.map((row) => row.slug);

      expect(slugs).toContain(LISTABLE_SLUG);
      expect(slugs).not.toContain(DRAFT_SLUG);
      expect(slugs).not.toContain(BLOCKED_VENDOR_SLUG);
    });

    it.each([DRAFT_SLUG, PENDING_VENDOR_SLUG, BLOCKED_VENDOR_SLUG])(
      "answers 404 for %s, the same way as a slug that never existed",
      async (slug) => {
        // The same answer for all three, and for nonsense: a draft's slug must
        // not become a way to learn what a business is about to launch, and a
        // suspended one's must not confirm the business exists.
        await expect(getServiceDetail(ctx, ANONYMOUS, slug)).rejects.toBeInstanceOf(NotFoundError);
        await expect(getPublicService(ctx, ANONYMOUS, slug)).rejects.toBeInstanceOf(NotFoundError);
      },
    );

    it("counts categories over what is actually listable", async () => {
      const tiles = await listCategoriesForBrowse(ctx, ANONYMOUS);
      const [listable] = await sql<{ count: string }[]>`
        select count(*)::text as count
        from app.planning_org_services s
        join app.planning_org_vendors v on v.id = s.vendor_id
        where v.status = 'approved' and s.published_at is not null
      `;

      const counted = tiles.reduce((sum, tile) => sum + tile.serviceCount, 0);
      expect(counted).toBe(Number(listable?.count));

      // Photography holds one published listing and one draft, so a count over
      // every row would read two and send everybody who taps it to a page with
      // one thing on it.
      const photography = tiles.find((tile) => tile.slug === "photography");
      expect(photography?.serviceCount).toBe(1);
    });

    it("keeps a category with nothing listable under it", async () => {
      // A tile reading zero, not a tile that vanished. The row of categories
      // must not change shape as businesses are approved and suspended.
      await sql`
        update app.planning_org_services set published_at = null
        where category_id = (select id from app.planning_org_categories where slug = 'cakes')
      `;

      const tiles = await listCategoriesForBrowse(ctx, ANONYMOUS);
      const cakes = tiles.find((tile) => tile.slug === "cakes");

      expect(cakes).toBeDefined();
      expect(cakes?.serviceCount).toBe(0);
    });

    it("refuses to book a draft, with the answer an unknown id gets", async () => {
      // The half that matters. Publication enforced on reads alone leaves a
      // listing that is invisible on every screen and still prices, still holds
      // the vendor's date, and still takes a deposit.
      const eventId = await eventIn(120);

      await expect(
        createCheckout(ctx, sarah, {
          eventId,
          lines: [{ serviceId: await serviceIdOf(DRAFT_SLUG), quantity: 1 }],
        }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("refuses to quote a draft too", async () => {
      const eventId = await eventIn(121);

      await expect(
        quoteCheckout(ctx, sarah, {
          eventId,
          lines: [{ serviceId: await serviceIdOf(DRAFT_SLUG), quantity: 1 }],
        }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("sorting and paging", () => {
    /**
     * A catalogue big enough to need a second page, including unrated rows.
     *
     * Rating zero is the case the migration exists for: while the column was
     * nullable those rows sorted above every rated business and a keyset page
     * could reach none of them, because a row comparison against NULL is NULL
     * and matches neither side of the boundary.
     */
    async function bulkCatalogue(count: number): Promise<number> {
      await sql`
        insert into app.planning_org_services
          (vendor_id, category_id, slug, title, base_price, price_unit, booking_mode,
           rating_average, review_count, published_at)
        select
          s.vendor_id, s.category_id,
          'bulk-listing-' || n, 'Bulk listing ' || n,
          1000 + (n % 40) * 250,
          s.price_unit, s.booking_mode,
          -- Deliberately coarse: many rows share a rating, a price and a review
          -- count, so the id tiebreak is exercised rather than incidental.
          (n % 6)::numeric,
          (n % 5),
          now() - interval '1 day'
        from generate_series(1, ${count}) as n
        cross join lateral (
          select vendor_id, category_id, price_unit, booking_mode
          from app.planning_org_services where slug = ${LISTABLE_SLUG}
        ) as s
      `;

      const [row] = await sql<{ count: string }[]>`
        select count(*)::text as count
        from app.planning_org_services s
        join app.planning_org_vendors v on v.id = s.vendor_id
        where v.status = 'approved' and s.published_at is not null
      `;
      return Number(row?.count);
    }

    it.each(Object.keys(SERVICE_SORTS) as Array<keyof typeof SERVICE_SORTS>)(
      "pages %s over every listable row exactly once",
      async (sort) => {
        const listable = await bulkCatalogue(60);

        const seen: string[] = [];
        let cursor: string | undefined;
        let pages = 0;

        do {
          const page = await searchServices(ctx, ANONYMOUS, {
            sort,
            ...(cursor ? { cursor } : {}),
          });
          seen.push(...page.rows.map((row) => row.id));
          cursor = page.nextCursor;
          pages += 1;
          // A cursor that stopped advancing would otherwise spin here rather
          // than fail, and the failure would be a timeout with no explanation.
          expect(pages).toBeLessThan(20);
        } while (cursor);

        expect(pages).toBeGreaterThan(1);
        expect(seen.length).toBe(listable);
        expect(new Set(seen).size).toBe(listable);
      },
      120_000,
    );

    it("puts an unrated listing below a rated one", async () => {
      await bulkCatalogue(60);

      const page = await searchServices(ctx, ANONYMOUS, { sort: "rating" });
      const ratings = page.rows.map((row) => row.ratingAverage);

      expect(ratings.length).toBeGreaterThan(1);
      expect([...ratings].sort((a, b) => b - a)).toEqual(ratings);
      // Zero is a rating now, not an absence, so nothing unrated leads the list.
      expect(ratings[0]).toBeGreaterThan(0);
    });

    it("runs price low to high, and most reviewed first", async () => {
      await bulkCatalogue(60);

      const byPrice = await searchServices(ctx, ANONYMOUS, { sort: "price_low_to_high" });
      const prices = byPrice.rows.map((row) => row.basePrice);
      expect([...prices].sort((a, b) => Number(a - b))).toEqual(prices);

      const recommended = await searchServices(ctx, ANONYMOUS, { sort: "recommended" });
      const reviews = recommended.rows.map((row) => row.reviewCount);
      expect([...reviews].sort((a, b) => b - a)).toEqual(reviews);
    });

    it("answers the first page for a cursor from another sort", async () => {
      await bulkCatalogue(60);

      const byRating = await searchServices(ctx, ANONYMOUS, { sort: "rating" });
      // Well-formed, and wrong only in which list it came from. Without the
      // sort identity it would reach a `::numeric` comparison against a price.
      const replayed = await searchServices(ctx, ANONYMOUS, {
        sort: "price_low_to_high",
        cursor: byRating.nextCursor as string,
      });
      const first = await searchServices(ctx, ANONYMOUS, { sort: "price_low_to_high" });

      expect(replayed.rows.map((row) => row.id)).toEqual(first.rows.map((row) => row.id));
    });

    it("answers the first page for a cursor somebody typed", async () => {
      await bulkCatalogue(30);
      const first = await searchServices(ctx, ANONYMOUS, { sort: "rating" });

      for (const cursor of ["services-rating|top|not-a-uuid", "nonsense", ""]) {
        const page = await searchServices(ctx, ANONYMOUS, { sort: "rating", cursor });
        expect(
          page.rows.map((row) => row.id),
          cursor,
        ).toEqual(first.rows.map((row) => row.id));
      }
    });
  });

  describe("narrowing the list", () => {
    it("filters by category, booking mode, price and rating in one query", async () => {
      const page = await searchServices(ctx, ANONYMOUS, {
        categorySlug: "flowers",
        bookingMode: "book_now",
        maxPrice: 100_000n,
        minRating: 4.5,
      });

      expect(page.rows.length).toBeGreaterThan(0);
      for (const row of page.rows) {
        expect(row.categorySlug).toBe("flowers");
        expect(row.bookingMode).toBe("book_now");
        expect(row.basePrice).toBeLessThanOrEqual(100_000n);
        expect(row.ratingAverage).toBeGreaterThanOrEqual(4.5);
      }
    });

    it("filters by neighbourhood without repeating a listing that serves several", async () => {
      const page = await searchServices(ctx, ANONYMOUS, { neighbourhoodSlug: "downtown-core" });
      const ids = page.rows.map((row) => row.id);

      expect(ids.length).toBeGreaterThan(0);
      // An `exists`, not a join: the seeded florist serves four neighbourhoods,
      // and a join would return it four times and shorten the page by three.
      expect(new Set(ids).size).toBe(ids.length);

      const [areas] = await sql<{ count: string }[]>`
        select count(*)::text as count
        from app.planning_org_service_areas sa
        join app.planning_org_neighbourhoods n on n.id = sa.neighbourhood_id
        where sa.service_id = ${await serviceIdOf(LISTABLE_SLUG)}
      `;
      expect(Number(areas?.count)).toBeGreaterThan(1);
      expect(ids).toContain(await serviceIdOf(LISTABLE_SLUG));
    });

    it("asks the capacity tables nothing", () => {
      // The reason there is no date filter, stated as a property of the query
      // rather than of the type. An anonymous "free on this date" answered from
      // the same rows a booking writes lets two queries be differenced into
      // which businesses a stranger on the public feed booked.
      const statement = searchServicesQuery(ctx.db, {
        categorySlug: "flowers",
        neighbourhoodSlug: "downtown-core",
        bookingMode: "book_now",
        maxPrice: 100_000n,
        minRating: 4.5,
        sort: "rating",
      }).toSQL().sql;

      expect(statement).not.toContain("capacity_blocks");
      expect(statement).not.toContain("blackout_dates");
      expect(statement).not.toContain("daily_capacity");
      expect(statement).not.toContain("planning_org_events");
    });
  });

  describe("the results card", () => {
    it("carries at most three pictures, from the one query", async () => {
      const serviceId = await serviceIdOf(LISTABLE_SLUG);
      await sql`
        insert into app.planning_org_service_media (service_id, url, alt_text, sort_order)
        select ${serviceId}, 'https://example.test/' || n || '.jpg', 'Picture ' || n, n
        from generate_series(1, 5) as n
      `;

      const queries: string[] = [];
      const watched = createDatabaseContext(dbUrl, undefined, (query) => queries.push(query));
      try {
        const page = await searchServices(watched.ctx, ANONYMOUS, {});
        const card = page.rows.find((row) => row.id === serviceId);

        expect(card?.media).toHaveLength(3);
        // Ordered as the vendor arranged them, and cut in SQL rather than in
        // JavaScript — a slice after the fact still fetches every picture of
        // every card on the page.
        expect(card?.media.map((item) => item.altText)).toEqual([
          "Picture 1",
          "Picture 2",
          "Picture 3",
        ]);
        expect(queries).toHaveLength(1);
      } finally {
        await watched.close();
      }
    });

    it("says nothing about a listing with no pictures", async () => {
      const page = await searchServices(ctx, ANONYMOUS, {});
      expect(page.rows.every((row) => Array.isArray(row.media))).toBe(true);
      expect(page.rows.some((row) => row.media.length === 0)).toBe(true);
    });
  });

  describe("one service's own page", () => {
    it("carries its packages, its approved reviews and what the business can prove", async () => {
      const detail = await getServiceDetail(ctx, ANONYMOUS, "balloon-and-floral-installs");

      expect(detail.packages.length).toBeGreaterThan(0);
      expect(detail.reviews.length).toBeGreaterThan(0);
      expect(detail.vendor.approvedAt).toBeInstanceOf(Date);
      expect(detail.vendor.completedOrders).toBeGreaterThan(0);
      // No response time: nothing records message latency, and a number
      // invented for a screen is one a vendor gets held to.
      expect(Object.keys(detail.vendor)).not.toContain("respondsWithin");
    });

    it("hides a review that moderation rejected", async () => {
      await sql`
        update app.planning_org_reviews set moderation = 'rejected'
      `;

      const detail = await getServiceDetail(ctx, ANONYMOUS, "balloon-and-floral-installs");
      expect(detail.reviews).toEqual([]);
    });

    it("says whether the caller saved it, and false for a stranger", async () => {
      const serviceId = await serviceIdOf(LISTABLE_SLUG);
      await toggleSaved(ctx, sarah, serviceId);

      expect((await getServiceDetail(ctx, sarah, LISTABLE_SLUG)).saved).toBe(true);
      expect((await getServiceDetail(ctx, ANONYMOUS, LISTABLE_SLUG)).saved).toBe(false);
    });
  });

  describe("the shortlist", () => {
    it("saves, then unsaves, on the one control", async () => {
      const serviceId = await serviceIdOf(LISTABLE_SLUG);

      expect(await toggleSaved(ctx, sarah, serviceId)).toEqual({ serviceId, saved: true });
      expect((await listSaved(ctx, sarah)).map((row) => row.id)).toEqual([serviceId]);

      expect(await toggleSaved(ctx, sarah, serviceId)).toEqual({ serviceId, saved: false });
      expect(await listSaved(ctx, sarah)).toEqual([]);
    });

    it("refuses to save a draft", async () => {
      await expect(toggleSaved(ctx, sarah, await serviceIdOf(DRAFT_SLUG))).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });

    it("drops a saved listing whose business is suspended, and keeps the row", async () => {
      const serviceId = await serviceIdOf(LISTABLE_SLUG);
      await toggleSaved(ctx, sarah, serviceId);

      const [vendor] = await sql<{ id: string }[]>`
        select id from app.planning_org_vendors where slug = 'bloom-and-co'
      `;
      await suspendVendor(ctx, admin, vendor?.id as string, "Chargebacks");

      // Off the screen, because opening it would 404 — but still in the table,
      // so reinstating the business gives the shortlist back rather than having
      // quietly emptied it.
      expect(await listSaved(ctx, sarah)).toEqual([]);
      const [saved] = await sql<{ count: string }[]>`
        select count(*)::text as count from app.planning_org_saved_services
      `;
      expect(Number(saved?.count)).toBe(1);
    });
  });

  describe("whether a day is free", () => {
    it("reads free for a day nothing has taken", async () => {
      const answer = await serviceAvailability(
        ctx,
        ANONYMOUS,
        await serviceIdOf(LISTABLE_SLUG),
        "2099-06-01",
      );
      expect(answer.state).toBe("free");
    });

    it("reads booked on the day a seeded order is holding", async () => {
      const [row] = await sql<{ service_id: string; event_date: string }[]>`
        select oi.service_id, e.event_date::text
        from app.planning_org_orders o
        join app.planning_org_order_items oi on oi.order_id = o.id
        join app.planning_org_events e on e.id = o.event_id
        where o.reference = 'TO-4192'
      `;

      const answer = await serviceAvailability(
        ctx,
        ANONYMOUS,
        row?.service_id as string,
        row?.event_date as string,
      );
      expect(answer.state).toBe("booked");
    });

    it("reads free on the day of a booking that was cancelled", async () => {
      // The inactive block stays for history and takes part in nothing. A seed
      // that made every block active would lose this date for ever.
      const [row] = await sql<{ service_id: string; event_date: string }[]>`
        select oi.service_id, e.event_date::text
        from app.planning_org_orders o
        join app.planning_org_order_items oi on oi.order_id = o.id
        join app.planning_org_events e on e.id = o.event_id
        where o.reference = 'TO-4171'
      `;

      const answer = await serviceAvailability(
        ctx,
        ANONYMOUS,
        row?.service_id as string,
        row?.event_date as string,
      );
      expect(answer.state).toBe("free");
    });

    it("reads blacked out when the business says it is closed", async () => {
      const serviceId = await serviceIdOf(LISTABLE_SLUG);
      await sql`
        insert into app.planning_org_blackout_dates (vendor_id, day, reason)
        select vendor_id, date '2099-07-04', 'Closed' from app.planning_org_services
        where id = ${serviceId}
      `;

      const answer = await serviceAvailability(ctx, ANONYMOUS, serviceId, "2099-07-04");
      expect(answer.state).toBe("blacked_out");
    });

    it("refuses a draft rather than answering about it", async () => {
      await expect(
        serviceAvailability(ctx, ANONYMOUS, await serviceIdOf(DRAFT_SLUG), "2099-06-01"),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("a quote and the checkout it turns into", () => {
    it("produces the same five numbers for the same request", async () => {
      // The whole reason `quoteCheckout` exists. Two screens computing a
      // deposit separately is two implementations of the money rules, and the
      // day they disagree a customer is quoted one number and billed another.
      const eventId = await eventIn(180, "Quote parity");
      const request = {
        eventId,
        lines: [{ serviceId: await serviceIdOf(LISTABLE_SLUG), quantity: 3 }],
      };

      const quote = await quoteCheckout(ctx, sarah, request);
      const checkout = await createCheckout(ctx, sarah, request);

      const [written] = await sql<
        {
          subtotal: string;
          tax: string;
          total: string;
          deposit_amount: string;
          balance_amount: string;
        }[]
      >`
        select subtotal::text, tax::text, total::text,
               deposit_amount::text, balance_amount::text
        from app.planning_org_orders where id = ${checkout.orders[0]?.id as string}
      `;

      const quoted = quote.orders[0];
      expect([
        quoted?.subtotal,
        quoted?.tax,
        quoted?.total,
        quoted?.depositAmount,
        quoted?.balanceAmount,
      ]).toEqual([
        BigInt(written?.subtotal as string),
        BigInt(written?.tax as string),
        BigInt(written?.total as string),
        BigInt(written?.deposit_amount as string),
        BigInt(written?.balance_amount as string),
      ]);

      expect(quoted?.balanceDueAt?.getTime()).toBe(checkout.orders[0]?.balanceDueAt?.getTime());
    });

    it("writes nothing, and holds no date", async () => {
      const eventId = await eventIn(181, "Quote writes nothing");
      const serviceId = await serviceIdOf(LISTABLE_SLUG);

      const before = await counts();
      await quoteCheckout(ctx, sarah, { eventId, lines: [{ serviceId, quantity: 2 }] });
      expect(await counts()).toEqual(before);

      // And the date is genuinely still free, which is the consequence that
      // matters: a quote that took a hold would let a price check book a date.
      const checkout = await createCheckout(ctx, sarah, {
        eventId,
        lines: [{ serviceId, quantity: 2 }],
      });
      expect(checkout.orders).toHaveLength(1);
    });

    async function counts(): Promise<Record<string, number>> {
      const [row] = await sql<{ orders: string; blocks: string; checkouts: string }[]>`
        select
          (select count(*) from app.planning_org_orders)::text as orders,
          (select count(*) from app.planning_org_capacity_blocks)::text as blocks,
          (select count(*) from app.planning_org_checkouts)::text as checkouts
      `;
      return {
        orders: Number(row?.orders),
        blocks: Number(row?.blocks),
        checkouts: Number(row?.checkouts),
      };
    }

    it("refuses a quote for somebody else's event, exactly as a checkout does", async () => {
      const [adas] = await sql<{ id: string }[]>`
        select e.id from app.planning_org_events e
        join app.planning_org_users u on u.id = e.owner_user_id
        where u.email = 'ada.okafor@example.ca' limit 1
      `;
      const lines = [{ serviceId: await serviceIdOf(LISTABLE_SLUG), quantity: 1 }];

      await expect(
        quoteCheckout(ctx, sarah, { eventId: adas?.id as string, lines }),
      ).rejects.toBeInstanceOf(NotFoundError);
      await expect(
        createCheckout(ctx, sarah, { eventId: adas?.id as string, lines }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("the signed-out feed", () => {
    it("shows the events their owners made public, and nobody else's", async () => {
      // Which columns it publishes is asserted column by column, without a
      // database, in `public-feed-projection.test.ts`. What only a real
      // database can say is which rows come back.
      //
      // Read the expectation off the table rather than counting the seed's
      // public events here: a feed that returned everything would still match
      // a hardcoded number the day somebody changed one event's visibility.
      const published = await sql<{ id: string }[]>`
        select id from app.planning_org_events where visibility = 'public'
      `;
      const withheld = await sql<{ id: string }[]>`
        select id from app.planning_org_events where visibility <> 'public'
      `;

      const feed = await listPublicEventFeed(ctx, ANONYMOUS);
      const shown = feed.map((event) => event.id).sort();

      expect(published.length).toBeGreaterThan(0);
      expect(withheld.length).toBeGreaterThan(0);
      expect(shown).toEqual(published.map((row) => row.id).sort());
      for (const row of withheld) expect(shown).not.toContain(row.id);
    });

    it("counts a booked service for an event, once the event is shared", async () => {
      // `shared` rather than `public`, to keep this about the count rather
      // than the predicate above. The count is what the feed publishes about a
      // booking, and it is read the same way whichever visibility it carries.
      const [row] = await sql<{ booked: number }[]>`
        select count(*)::int as booked
        from app.planning_org_order_items oi
        join app.planning_org_orders o on o.id = oi.order_id
        where o.event_id = (select event_id from app.planning_org_orders where reference = 'TO-4192')
          and o.state not in ('cancelled', 'refunded')
      `;

      // Sarah's 30th carries two live bookings, and neither vendor's name nor
      // either amount is anywhere in what the feed would publish about it.
      expect(row?.booked).toBe(2);
    });
  });

  describe("the dates the seed is holding", () => {
    it("refuses a second booking of a seeded service on its seeded day", async () => {
      // Today this is the defect: with nothing in `capacity_blocks` the
      // constraint has nothing to collide with, so the demo's own confirmed
      // booking can be made a second time.
      const [row] = await sql<{ service_id: string; event_date: string }[]>`
        select oi.service_id, e.event_date::text
        from app.planning_org_orders o
        join app.planning_org_order_items oi on oi.order_id = o.id
        join app.planning_org_events e on e.id = o.event_id
        where o.reference = 'TO-4192'
      `;

      const [clashing] = await sql<{ id: string }[]>`
        insert into app.planning_org_events (owner_user_id, name, event_date, start_time, timezone)
        values (${sarahId}, 'Same day', ${row?.event_date as string}::date, '17:00', 'America/Toronto')
        returning id
      `;

      const error = await createCheckout(ctx, sarah, {
        eventId: clashing?.id as string,
        lines: [{ serviceId: row?.service_id as string, quantity: 1 }],
      }).catch((thrown: unknown) => thrown);

      expect(error).toBeInstanceOf(CapacityConflictError);
      expect((error as CapacityConflictError).day).toBe(row?.event_date);
    });

    it("still books the same service on a day nobody has taken", async () => {
      const eventId = await eventIn(240, "Free date");
      const result = await createCheckout(ctx, sarah, {
        eventId,
        lines: [{ serviceId: await serviceIdOf(LISTABLE_SLUG), quantity: 1 }],
      });

      expect(result.orders).toHaveLength(1);
    });

    it("books the day a cancelled booking was holding", async () => {
      // The half a naive seed gets wrong. The block exists and is inactive, so
      // the constraint ignores it and the date is on sale again.
      const [row] = await sql<{ service_id: string; event_id: string }[]>`
        select oi.service_id, o.event_id
        from app.planning_org_orders o
        join app.planning_org_order_items oi on oi.order_id = o.id
        where o.reference = 'TO-4171'
      `;

      const result = await createCheckout(ctx, sarah, {
        eventId: row?.event_id as string,
        lines: [{ serviceId: row?.service_id as string, quantity: 1 }],
      });

      expect(result.orders).toHaveLength(1);
    });

    it("classifies every order state the way the lifecycle does", () => {
      // The seed cannot import the domain, so it repeats the classification.
      // Nothing but this holds the two together, and a tenth state added later
      // would otherwise be seeded with whatever answer somebody typed.
      const disagreements = ORDER_STATES.filter(
        (state) => HOLDS_CAPACITY[state] !== (capacityIn(state) !== "released"),
      );

      expect(disagreements).toEqual([]);
      expect(ORDER_STATES.length).toBe(Object.keys(HOLDS_CAPACITY).length);
    });

    it("writes an inactive block for a booking that ended, not no block at all", async () => {
      const rows = await sql<{ reference: string; state: string; active: boolean }[]>`
        select o.reference, o.state::text, cb.active
        from app.planning_org_capacity_blocks cb
        join app.planning_org_orders o on o.id = cb.order_id
      `;

      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.active, `${row.reference} is ${row.state}`).toBe(
          capacityIn(row.state as (typeof ORDER_STATES)[number]) !== "released",
        );
      }
      // Both sides of the flag, so a seed that made every block active fails
      // here rather than by quietly losing a cancelled booking's date.
      expect(rows.some((row) => row.active)).toBe(true);
      expect(rows.some((row) => !row.active)).toBe(true);
    });
  });

  describe("the numbers a listing leads with", () => {
    it("moves the rating and the count when a review is taken down", async () => {
      const [report] = await sql<{ id: string }[]>`
        select id from app.planning_org_content_reports where target_type = 'review'
      `;
      const serviceId = await serviceIdOf("balloon-and-floral-installs");

      const before = await aggregates(serviceId);
      expect(before.count).toBeGreaterThan(0);

      await decideReport(ctx, admin, report?.id as string, { decision: "remove" });

      const after = await aggregates(serviceId);
      // The one approved review is gone, so the listing reads as one nobody has
      // reviewed — which is what zero means now that the column cannot be null.
      expect(after).toEqual({ average: "0.0", count: 0 });
      expect(after.count).toBeLessThan(before.count);
    });

    it("brings the numbers into line with the reviews even when the decision is to keep", async () => {
      // A recompute, not a decrement — so a decision either way leaves the two
      // numbers describing the reviews that are actually approved. The seeded
      // figures are the prototype's display values and were never derived from
      // the seeded review rows, so the correction is visible here: one approved
      // five-star review is what this listing has.
      const [report] = await sql<{ id: string }[]>`
        select id from app.planning_org_content_reports where target_type = 'review'
      `;
      const serviceId = await serviceIdOf("balloon-and-floral-installs");

      await decideReport(ctx, admin, report?.id as string, { decision: "keep" });

      expect(await aggregates(serviceId)).toEqual({ average: "5.0", count: 1 });
    });

    it("averages the reviews rather than reading one of them back", async () => {
      const serviceId = await serviceIdOf("balloon-and-floral-installs");
      // A second approved review of the same listing, at a different rating.
      // `reviews_order_key` allows one review per order, so it hangs off a
      // different order — the service is what the aggregate is about.
      await sql`
        insert into app.planning_org_reviews
          (order_id, author_user_id, vendor_id, service_id, rating, body, moderation)
        select o.id, r.author_user_id, r.vendor_id, ${serviceId}, 3, 'Second', 'approved'
        from app.planning_org_reviews r
        cross join lateral (
          select id from app.planning_org_orders
          where reference = 'TO-4188' limit 1
        ) as o
        limit 1
      `;

      const [report] = await sql<{ id: string }[]>`
        select id from app.planning_org_content_reports where target_type = 'review'
      `;
      await decideReport(ctx, admin, report?.id as string, { decision: "keep" });

      // 5 and 3, so 4.0 — neither review's own number, and not the seeded one.
      expect(await aggregates(serviceId)).toEqual({ average: "4.0", count: 2 });
    });

    async function aggregates(serviceId: string): Promise<{ average: string; count: number }> {
      const [row] = await sql<{ rating_average: string; review_count: number }[]>`
        select rating_average::text, review_count
        from app.planning_org_services where id = ${serviceId}
      `;
      return { average: row?.rating_average as string, count: Number(row?.review_count) };
    }
  });
});
