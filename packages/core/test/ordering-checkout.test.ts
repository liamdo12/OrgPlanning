import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type postgres from "postgres";
import type { Actor } from "../src/identity/actor.js";
import type { CoreContext } from "../src/context.js";
import { CapacityConflictError, NotFoundError } from "../src/errors.js";
import { getActor } from "../src/identity/service.js";
import { createCheckout } from "../src/ordering/service.js";
import { createStripeFake, type StripeFake } from "../src/testing/stripe-fake.js";
import { createDatabaseContext, ownerSql, resetDatabase, testDatabaseUrl } from "./harness.js";

/**
 * What the checkout transaction has to survive: a clash, and a race.
 *
 * Both claims need a real database and one of them needs two connections, so
 * neither can be made anywhere else. The clash is the exclusion constraint
 * refusing a second hold on a date, which arrives as a driver error and has to
 * reach a screen as something a person can act on. The race is a date moving
 * underneath a checkout that has already read it — no error anywhere, just a
 * booking that holds one day and charges for another.
 */

const url = testDatabaseUrl();

/** Long enough for a blocked statement to have shown it is blocked. */
const SETTLE_MS = 400;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(!url)("the checkout transaction", () => {
  const dbUrl = url as string;
  let sql: postgres.Sql;
  let database: ReturnType<typeof createDatabaseContext>;
  let ctx: CoreContext;
  let stripe: StripeFake;
  let customer: Actor;
  let sarahId: string;
  let bloomServiceId: string;

  beforeAll(async () => {
    await resetDatabase(dbUrl);
    sql = ownerSql(dbUrl);
  }, 120_000);

  afterAll(async () => {
    await database?.close();
    await sql?.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await resetDatabase(dbUrl);
    await database?.close();

    stripe = createStripeFake();
    database = createDatabaseContext(dbUrl, stripe);
    ctx = database.ctx;

    await sql`update app.planning_org_users set auth_provider_sub = 'provider-sub-' || email`;

    const [sarah] = await sql<{ id: string }[]>`
      select id from app.planning_org_users where email = 'sarah@example.ca'
    `;
    sarahId = sarah?.id as string;

    const [service] = await sql<{ id: string }[]>`
      select s.id from app.planning_org_services s
      join app.planning_org_vendors v on v.id = s.vendor_id
      where v.slug = 'bloom-and-co' and v.status = 'approved'
      limit 1
    `;
    bloomServiceId = service?.id as string;

    signInAs("sarah@example.ca");
    customer = await getActor(ctx, {});
  }, 120_000);

  function signInAs(email: string): void {
    database.setUser({
      id: `provider-sub-${email}`,
      email,
      issuedAt: new Date(),
      emailVerified: true,
      secondFactorVerified: true,
    });
  }

  /** An event of Sarah's, a given number of days out. */
  async function eventIn(days: number): Promise<{ id: string; day: string }> {
    const [row] = await sql<{ id: string; day: string }[]>`
      insert into app.planning_org_events (owner_user_id, name, event_date, start_time, timezone)
      values (
        ${sarahId},
        ${`Event in ${days} days`},
        (now() + (${days} || ' days')::interval)::date,
        '17:00',
        'America/Toronto'
      )
      returning id, event_date::text as day
    `;
    return { id: row?.id as string, day: row?.day as string };
  }

  /**
   * A second listing of the same business, sold under the same terms.
   *
   * Published, like the one it is copied from. A draft is not bookable, so a
   * fixture that left the column null would refuse every checkout below with
   * `NotFoundError` and read as a policy failure.
   */
  async function siblingService(): Promise<string> {
    const [row] = await sql<{ id: string }[]>`
      insert into app.planning_org_services
        (vendor_id, category_id, slug, title, base_price, price_unit, booking_mode,
         policy_template_id, published_at)
      select s.vendor_id, s.category_id, 'sibling-listing', 'Sibling listing',
             s.base_price, s.price_unit, s.booking_mode, s.policy_template_id,
             s.published_at
      from app.planning_org_services s where s.id = ${bloomServiceId}
      returning id
    `;
    return row?.id as string;
  }

  function book(eventId: string, serviceIds: readonly string[]) {
    signInAs("sarah@example.ca");
    return createCheckout(ctx, customer, {
      eventId,
      lines: serviceIds.map((serviceId) => ({ serviceId, quantity: 1 })),
    });
  }

  describe("a date already taken", () => {
    it("names the service and the day instead of a driver error", async () => {
      const first = await eventIn(160);
      await book(first.id, [bloomServiceId]);

      // A second event on the same day, booking the same service. The
      // exclusion constraint is what actually refuses it — two requests that
      // both passed an application-level check still cannot both commit.
      const [clashing] = await sql<{ id: string }[]>`
        insert into app.planning_org_events (owner_user_id, name, event_date, start_time, timezone)
        values (${sarahId}, 'Same day', ${first.day}::date, '17:00', 'America/Toronto')
        returning id
      `;

      const error = await book(clashing?.id as string, [bloomServiceId]).catch(
        (thrown: unknown) => thrown,
      );

      expect(error).toBeInstanceOf(CapacityConflictError);
      const conflict = error as CapacityConflictError;
      // The two facts a screen needs to offer another date rather than render
      // "conflicting key value violates exclusion constraint".
      expect(conflict.serviceId).toBe(bloomServiceId);
      expect(conflict.day).toBe(first.day);
    });

    it("leaves nothing behind when it refuses", async () => {
      const first = await eventIn(161);
      await book(first.id, [bloomServiceId]);

      const [clashing] = await sql<{ id: string }[]>`
        insert into app.planning_org_events (owner_user_id, name, event_date, start_time, timezone)
        values (${sarahId}, 'Same day again', ${first.day}::date, '17:00', 'America/Toronto')
        returning id
      `;

      await expect(book(clashing?.id as string, [bloomServiceId])).rejects.toBeInstanceOf(
        CapacityConflictError,
      );

      // The orders written before the hold went in are rolled back with it.
      // Nobody has been charged, because nothing has been charged yet — but a
      // surviving `pending_payment` row would hold a soft expiry against a
      // booking that never happened.
      const [count] = await sql<{ n: string }[]>`
        select count(*)::text as n from app.planning_org_orders
        where event_id = ${clashing?.id as string}
      `;
      expect(count?.n).toBe("0");
    });

    it("lets the same service take a different day", async () => {
      const first = await eventIn(162);
      await book(first.id, [bloomServiceId]);

      const second = await eventIn(163);
      const result = await book(second.id, [bloomServiceId]);
      expect(result.orders).toHaveLength(1);
    });

    it("re-throws a different exclusion violation rather than calling it a clash", async () => {
      // Same SQLSTATE, different constraint. Matching the code alone would
      // report this as "that date is already booked" — which is not what
      // happened, and sends the customer to change a date that was never the
      // problem.
      const sibling = await siblingService();
      const event = await eventIn(164);

      await sql.unsafe(`
        alter table app.planning_org_capacity_blocks
        add constraint capacity_blocks_one_per_order_fixture
        exclude using gist (order_id with =) where (active)
      `);

      try {
        const error = await book(event.id, [bloomServiceId, sibling]).catch(
          (thrown: unknown) => thrown,
        );

        expect(error).toBeInstanceOf(Error);
        expect(error).not.toBeInstanceOf(CapacityConflictError);
      } finally {
        await sql.unsafe(`
          alter table app.planning_org_capacity_blocks
          drop constraint capacity_blocks_one_per_order_fixture
        `);
      }
    });
  });

  describe("a date moving underneath a checkout", () => {
    it("waits for a date change in flight, then prices against what it left", async () => {
      const event = await eventIn(170);
      const [moved] = await sql<{ day: string }[]>`
        select ((${event.day}::date) + 3)::text as day
      `;
      const newDay = moved?.day as string;

      let settled = false;
      let checkout: ReturnType<typeof book> | undefined;

      await sql.begin(async (tx) => {
        // Exactly what the checkout itself takes, from another connection.
        await tx`
          select id from app.planning_org_events where id = ${event.id} for update
        `;

        checkout = book(event.id, [bloomServiceId]);
        // Swallowed here and awaited below: an unhandled rejection while this
        // transaction is still open would fail the run somewhere else entirely.
        void checkout.then(
          () => {
            settled = true;
          },
          () => {
            settled = true;
          },
        );

        await wait(SETTLE_MS);
        // The claim. Without the lock the checkout has already read the old
        // date and is busy pricing against it.
        expect(settled, "the checkout did not wait for the event row").toBe(false);

        await tx`
          update app.planning_org_events set event_date = ${newDay}::date where id = ${event.id}
        `;
      });

      const result = await (checkout as ReturnType<typeof book>);
      const order = result.orders[0] as NonNullable<(typeof result.orders)[number]>;

      // It read the row after the change committed, so every date it derived
      // is the new one — including the date it actually holds.
      const [held] = await sql<{ day: string }[]>`
        select (lower(during) at time zone 'America/Toronto')::date::text as day
        from app.planning_org_capacity_blocks where order_id = ${order.id}
      `;
      expect(held?.day).toBe(newDay);
    });

    it("gives the date back when the transaction that moved it rolls back", async () => {
      const event = await eventIn(171);

      let settled = false;
      let checkout: ReturnType<typeof book> | undefined;

      await expect(
        sql.begin(async (tx) => {
          await tx`
            select id from app.planning_org_events where id = ${event.id} for update
          `;
          await tx`delete from app.planning_org_events where id = ${event.id}`;

          checkout = book(event.id, [bloomServiceId]);
          void checkout.then(
            () => {
              settled = true;
            },
            () => {
              settled = true;
            },
          );

          await wait(SETTLE_MS);
          expect(settled, "the checkout did not wait for the event row").toBe(false);

          throw new Error("rolled back");
        }),
      ).rejects.toThrow("rolled back");

      // The delete never committed, so the event is still there and the
      // checkout that waited for it books normally.
      const result = await (checkout as ReturnType<typeof book>);
      expect(result.orders).toHaveLength(1);
    });

    it("refuses an event that was really deleted while it waited", async () => {
      const event = await eventIn(172);

      let checkout: ReturnType<typeof book> | undefined;
      let failure: unknown;

      await sql.begin(async (tx) => {
        await tx`
          select id from app.planning_org_events where id = ${event.id} for update
        `;

        checkout = book(event.id, [bloomServiceId]);
        void checkout.then(
          () => undefined,
          (error: unknown) => {
            failure = error;
          },
        );

        await wait(SETTLE_MS);
        await tx`delete from app.planning_org_events where id = ${event.id}`;
      });

      await expect(checkout as ReturnType<typeof book>).rejects.toBeInstanceOf(NotFoundError);
      expect(failure).toBeInstanceOf(NotFoundError);
    });
  });
});
