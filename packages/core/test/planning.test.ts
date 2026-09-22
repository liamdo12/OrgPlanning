import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type postgres from "postgres";
import { ANONYMOUS, SYSTEM, type Actor } from "../src/identity/actor.js";
import type { CoreContext } from "../src/context.js";
import { NotFoundError, ValidationError } from "../src/errors.js";
import { getActor } from "../src/identity/service.js";
import {
  addItemToPlan,
  cancelEvent,
  createEvent,
  eventHub,
  getEvent,
  listEventsForOwner,
  removeItemFromPlan,
  updateEvent,
} from "../src/planning/service.js";
import { createDatabaseContext, ownerSql, resetDatabase, testDatabaseUrl } from "./harness.js";

/**
 * The planner against a real database.
 *
 * Three of the claims here cannot be made anywhere else: the slots land in the
 * same transaction as the event, the unique key is what stops a second slot for
 * one category, and the refusal to move a date holds against a booking arriving
 * on another connection at the same moment. The last one needs two of them.
 */

const url = testDatabaseUrl();

/** Long enough for a blocked statement to have shown it is blocked. */
const SETTLE_MS = 400;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(!url)("planning", () => {
  const dbUrl = url as string;
  let sql: postgres.Sql;
  let database: ReturnType<typeof createDatabaseContext>;
  let ctx: CoreContext;

  let sarah: Actor;
  let ada: Actor;
  let admin: Actor;
  let sarahId: string;
  let sarahsThirtiethId: string;
  let babyShowerId: string;
  let cakeServiceId: string;
  let cakesCategoryId: string;

  beforeAll(() => {
    sql = ownerSql(dbUrl);
  });

  afterAll(async () => {
    await database?.close();
    await sql?.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await resetDatabase(dbUrl);
    await database?.close();

    database = createDatabaseContext(dbUrl);
    ctx = database.ctx;

    await sql`update app.planning_org_users set auth_provider_sub = 'provider-sub-' || email`;

    sarah = await signInAs("sarah@example.ca");
    sarahId = (sarah as Extract<Actor, { kind: "user" }>).userId;
    ada = await signInAs("ada.okafor@example.ca");
    admin = await signInAs("admin@occasion.test");

    sarahsThirtiethId = await one(sql`
      select id from app.planning_org_events where name = 'Sarah''s 30th'
    `);
    babyShowerId = await one(sql`
      select id from app.planning_org_events where name = 'Baby shower'
    `);
    cakesCategoryId = await one(sql`
      select id from app.planning_org_categories where slug = 'cakes'
    `);
    cakeServiceId = await one(sql`
      select s.id from app.planning_org_services s
      join app.planning_org_vendors v on v.id = s.vendor_id
      where v.status = 'approved' and s.category_id = ${cakesCategoryId}
      limit 1
    `);

    // Back to the owner, who runs most of what follows.
    await signInAs("sarah@example.ca");
  }, 120_000);

  async function signInAs(email: string): Promise<Actor> {
    database.setUser({
      id: `provider-sub-${email}`,
      email,
      issuedAt: new Date(),
      emailVerified: true,
      secondFactorVerified: true,
    });
    return getActor(ctx, {});
  }

  async function one(query: postgres.PendingQuery<{ id: string }[]>): Promise<string> {
    const [row] = await query;
    return row?.id as string;
  }

  async function activeCategoryCount(): Promise<number> {
    const [row] = await sql<{ n: number }[]>`
      select count(*)::int as n from app.planning_org_categories where active
    `;
    return row?.n as number;
  }

  describe("whose event it is", () => {
    it("lets the owner read their own", async () => {
      const event = await getEvent(ctx, sarah, sarahsThirtiethId);
      expect(event.name).toBe("Sarah's 30th");
    });

    it("refuses every other identity, with the same answer each time", async () => {
      // Another customer, nobody at all, and the platform's own principal.
      // `NotFoundError` for all of them, so none of this says which ids exist.
      for (const actor of [ada, ANONYMOUS, SYSTEM]) {
        await expect(getEvent(ctx, actor, sarahsThirtiethId)).rejects.toThrow(NotFoundError);
      }
    });

    it("refuses an administrator, which the read policy alone would not", async () => {
      // `assertCanReadEvent` returns early for any admin. Every entry point here
      // is guarded by the *write* policy instead, because the planner's every
      // control acts on the event.
      await expect(getEvent(ctx, admin, sarahsThirtiethId)).rejects.toThrow(NotFoundError);
      await expect(eventHub(ctx, admin, sarahsThirtiethId)).rejects.toThrow(NotFoundError);
      await expect(updateEvent(ctx, admin, sarahsThirtiethId, { guestCount: 1 })).rejects.toThrow(
        NotFoundError,
      );
      await expect(cancelEvent(ctx, admin, sarahsThirtiethId)).rejects.toThrow(NotFoundError);
      await expect(
        addItemToPlan(ctx, admin, { eventId: sarahsThirtiethId, serviceId: cakeServiceId }),
      ).rejects.toThrow(NotFoundError);
      await expect(
        removeItemFromPlan(ctx, admin, {
          eventId: sarahsThirtiethId,
          categoryId: cakesCategoryId,
        }),
      ).rejects.toThrow(NotFoundError);
    });

    it("refuses an administrator starting one at all", async () => {
      // The policy above would refuse them their own event on every screen
      // afterwards, so allowing this would only make an event nobody can open.
      await expect(
        createEvent(ctx, admin, { name: "Admin party", eventDate: "2027-05-05" }),
      ).rejects.toThrow(NotFoundError);
    });

    it("lists only the owner's own events", async () => {
      const mine = await listEventsForOwner(ctx, sarah);
      const names = mine.map((event) => event.name).sort();

      expect(names).toEqual(["Baby shower", "Office social", "Sarah's 30th"]);
    });

    it("refuses a forged id the same way it refuses somebody else's", async () => {
      const forged = "00000000-0000-4000-8000-000000000000";
      await expect(getEvent(ctx, sarah, forged)).rejects.toThrow(NotFoundError);
    });
  });

  describe("starting an event", () => {
    it("gives it one slot per category that is currently offered", async () => {
      // "One per category", never a literal six: `categories` has no hierarchy
      // column and the categories screen can add and remove rows.
      const expected = await activeCategoryCount();
      const event = await createEvent(ctx, sarah, {
        name: "Housewarming",
        eventDate: "2027-08-08",
      });

      expect(event.items).toHaveLength(expected);
      expect(new Set(event.items.map((item) => item.categoryId)).size).toBe(expected);
      expect(event.items.every((item) => item.state.kind === "empty")).toBe(true);
    });

    it("follows the table rather than a constant", async () => {
      // The proof that the count is read and not remembered: deactivate one and
      // the next event gets one fewer, with no code change anywhere.
      await sql`update app.planning_org_categories set active = false where slug = 'cakes'`;
      const expected = await activeCategoryCount();

      const event = await createEvent(ctx, sarah, {
        name: "Cakeless party",
        eventDate: "2027-08-09",
      });

      expect(event.items).toHaveLength(expected);
      expect(event.items.some((item) => item.categorySlug === "cakes")).toBe(false);
    });

    it("writes the event and its slots together or not at all", async () => {
      // Nothing can be filed under a category that does not exist, so removing
      // every one of them is the failure that leaves an event with no planner.
      const before = await one(sql`select count(*)::text as id from app.planning_org_events`);

      await sql`update app.planning_org_categories set active = false`;
      const event = await createEvent(ctx, sarah, { name: "Empty", eventDate: "2027-08-10" });

      // The event still lands; it simply has no slots, because there are no
      // categories to have one for. What must not happen is slots without an
      // event, or an event whose slot insert failed silently.
      expect(event.items).toEqual([]);
      const after = await one(sql`select count(*)::text as id from app.planning_org_events`);
      expect(Number(after)).toBe(Number(before) + 1);
    });

    it("belongs to whoever created it", async () => {
      const event = await createEvent(ctx, sarah, { name: "Mine", eventDate: "2027-08-11" });
      const owner = await one(
        sql`select owner_user_id as id from app.planning_org_events where id = ${event.id}`,
      );

      expect(owner).toBe(sarahId);
      await expect(getEvent(ctx, ada, event.id)).rejects.toThrow(NotFoundError);
    });
  });

  describe("filling a slot", () => {
    it("updates the category's existing row rather than adding a second", async () => {
      const first = await addItemToPlan(ctx, sarah, {
        eventId: sarahsThirtiethId,
        serviceId: cakeServiceId,
        quantity: 1,
      });
      const second = await addItemToPlan(ctx, sarah, {
        eventId: sarahsThirtiethId,
        serviceId: cakeServiceId,
        quantity: 4,
      });

      expect(second.id).toBe(first.id);
      expect(second.quantity).toBe(4);

      const [count] = await sql<{ n: number }[]>`
        select count(*)::int as n from app.planning_org_event_items
        where event_id = ${sarahsThirtiethId} and category_id = ${cakesCategoryId}
      `;
      expect(count?.n).toBe(1);
    });

    it("is one slot per category by constraint, not by convention", async () => {
      // The rule above is only a rule while every caller remembers it. This is
      // what makes it an invariant: a raw second insert is refused.
      await expect(
        sql`
          insert into app.planning_org_event_items (event_id, category_id)
          values (${sarahsThirtiethId}, ${cakesCategoryId})
        `,
      ).rejects.toThrow(/event_items_event_category_key/);
    });

    it("files the service under its own category", async () => {
      const item = await addItemToPlan(ctx, sarah, {
        eventId: sarahsThirtiethId,
        serviceId: cakeServiceId,
      });

      expect(item.categoryId).toBe(cakesCategoryId);
      expect(item.state).toEqual({ kind: "in_plan" });
    });

    it("refuses a package belonging to another service", async () => {
      const otherPackage = await one(sql`
        select id from app.planning_org_service_packages
        where service_id <> ${cakeServiceId} limit 1
      `);

      await expect(
        addItemToPlan(ctx, sarah, {
          eventId: sarahsThirtiethId,
          serviceId: cakeServiceId,
          servicePackageId: otherPackage,
        }),
      ).rejects.toThrow(NotFoundError);
    });

    it("refuses a quantity that is not a whole number of at least one", async () => {
      for (const quantity of [0, -1, 1.5]) {
        await expect(
          addItemToPlan(ctx, sarah, {
            eventId: sarahsThirtiethId,
            serviceId: cakeServiceId,
            quantity,
          }),
        ).rejects.toThrow(ValidationError);
      }
    });

    it("empties the slot without taking the category off the planner", async () => {
      await addItemToPlan(ctx, sarah, {
        eventId: sarahsThirtiethId,
        serviceId: cakeServiceId,
        arrivalTime: "16:00",
      });

      const cleared = await removeItemFromPlan(ctx, sarah, {
        eventId: sarahsThirtiethId,
        categoryId: cakesCategoryId,
      });

      expect(cleared.state).toEqual({ kind: "empty" });
      expect(cleared.serviceId).toBeNull();
      expect(cleared.arrivalTime).toBeNull();

      const event = await getEvent(ctx, sarah, sarahsThirtiethId);
      expect(event.items.some((item) => item.categoryId === cakesCategoryId)).toBe(true);
    });
  });

  describe("slot state, which is derived and not stored", () => {
    it("has no column to store it in", async () => {
      const [row] = await sql<{ n: number }[]>`
        select count(*)::int as n from information_schema.columns
        where table_schema = 'app' and table_name = 'planning_org_event_items'
          and column_name in ('state', 'status', 'slot_state')
      `;
      expect(row?.n).toBe(0);
    });

    it("reads a slot as booked from its order alone", async () => {
      // The seeded flowers booking on this event, linked to its slot the way
      // the checkout will link it.
      const flowersCategoryId = await one(
        sql`select id from app.planning_org_categories where slug = 'flowers'`,
      );
      const orderId = await one(
        sql`select id from app.planning_org_orders where reference = 'TO-4192'`,
      );
      await sql`
        update app.planning_org_event_items set order_id = ${orderId}
        where event_id = ${sarahsThirtiethId} and category_id = ${flowersCategoryId}
      `;

      const booked = await slotFor(flowersCategoryId);
      expect(booked?.state).toEqual({ kind: "booked" });

      // Cancelling the order gives the slot back, with nothing written to it.
      await sql`
        update app.planning_org_orders set state = 'cancelled' where id = ${orderId}
      `;
      const released = await slotFor(flowersCategoryId);
      expect(released?.state).toEqual({ kind: "empty" });

      const stillNamed = await one(sql`
        select order_id as id from app.planning_org_event_items
        where event_id = ${sarahsThirtiethId} and category_id = ${flowersCategoryId}
      `);
      expect(stillNamed).toBe(orderId);
    });

    it("counts the offers on an open request", async () => {
      const cateringCategoryId = await one(
        sql`select id from app.planning_org_categories where slug = 'catering'`,
      );
      const requestId = await one(sql`
        select id from app.planning_org_quote_requests where state = 'open' limit 1
      `);
      await sql`
        update app.planning_org_event_items set quote_request_id = ${requestId}
        where event_id = ${sarahsThirtiethId} and category_id = ${cateringCategoryId}
      `;

      const [offers] = await sql<{ n: number }[]>`
        select count(*)::int as n from app.planning_org_quote_offers
        where quote_request_id = ${requestId}
      `;

      const slot = await slotFor(cateringCategoryId);
      expect(slot?.state).toEqual({ kind: "quotes", count: offers?.n });
    });

    async function slotFor(categoryId: string) {
      const event = await getEvent(ctx, sarah, sarahsThirtiethId);
      return event.items.find((item) => item.categoryId === categoryId);
    }
  });

  describe("the budget", () => {
    it("sums the pre-tax subtotals of the bookings that still hold their dates", async () => {
      // The event's two live orders are TO-4192 and TO-4191, whose subtotals are
      // C$290.00 and C$450.00 — so C$740.00 committed, pre-tax.
      const hub = await eventHub(ctx, sarah, sarahsThirtiethId);

      expect(hub.budget.committed).toBe(74_000n);
      expect(hub.budget.budget).toBe(400_000n);
      expect(hub.budget.remaining).toBe(326_000n);
    });

    it("counts no tax", async () => {
      // What the same two orders total *with* HST. The committed figure must
      // not be this, or a customer is told they overspent on tax.
      const [totals] = await sql<{ total: string }[]>`
        select coalesce(sum(total), 0)::text as total from app.planning_org_orders
        where event_id = ${sarahsThirtiethId} and state not in ('cancelled', 'refunded')
      `;

      const hub = await eventHub(ctx, sarah, sarahsThirtiethId);
      expect(hub.budget.committed).not.toBe(BigInt(totals?.total as string));
    });

    it("gives the money back when a booking is cancelled", async () => {
      await sql`
        update app.planning_org_orders set state = 'cancelled'
        where reference = 'TO-4191'
      `;

      const hub = await eventHub(ctx, sarah, sarahsThirtiethId);
      expect(hub.budget.committed).toBe(29_000n);
    });

    it("counts a slot in plan at what buying it would charge", async () => {
      const before = await eventHub(ctx, sarah, sarahsThirtiethId);
      const [price] = await sql<{ base: string }[]>`
        select base_price::text as base from app.planning_org_services
        where id = ${cakeServiceId}
      `;

      await addItemToPlan(ctx, sarah, {
        eventId: sarahsThirtiethId,
        serviceId: cakeServiceId,
        quantity: 3,
      });

      const after = await eventHub(ctx, sarah, sarahsThirtiethId);
      expect(after.budget.committed - before.budget.committed).toBe(
        BigInt(price?.base as string) * 3n,
      );
    });

    it("does not count a bought slot twice", async () => {
      // A slot whose order exists is counted from the order side. Counting the
      // slot as well would charge the budget twice for one booking.
      const flowersCategoryId = await one(
        sql`select id from app.planning_org_categories where slug = 'flowers'`,
      );
      const orderId = await one(
        sql`select id from app.planning_org_orders where reference = 'TO-4192'`,
      );
      const serviceId = await one(sql`
        select service_id as id from app.planning_org_order_items where order_id = ${orderId}
      `);
      await sql`
        update app.planning_org_event_items
        set order_id = ${orderId}, service_id = ${serviceId}
        where event_id = ${sarahsThirtiethId} and category_id = ${flowersCategoryId}
      `;

      const hub = await eventHub(ctx, sarah, sarahsThirtiethId);
      expect(hub.budget.committed).toBe(74_000n);
    });
  });

  describe("what will be taken, and when", () => {
    it("names the soonest balance a confirmed booking still owes", async () => {
      // The state a booking waits in is `confirmed`; `balance_due` is entered
      // and left inside one provider round trip. A summary that only looked
      // there reported no next charge at all on an ordinary event — on the one
      // panel whose entire job is to say what is coming.
      const owed = await sql<{ due: Date; amount: string; reference: string }[]>`
        select balance_due_at as due, balance_amount::text as amount, reference
        from app.planning_org_orders
        where event_id = ${sarahsThirtiethId}
          and state in ('confirmed', 'balance_due', 'action_required')
          and balance_amount > 0 and balance_due_at is not null
        order by balance_due_at asc
      `;
      const soonest = owed[0];
      expect(soonest).toBeDefined();

      const hub = await eventHub(ctx, sarah, sarahsThirtiethId);

      expect(hub.payments.nextChargeAt?.getTime()).toBe(soonest?.due.getTime());
      expect(hub.payments.nextCharge).toBe(BigInt(soonest?.amount as string));
      expect(hub.payments.nextChargeStatus).toBe("scheduled");
    });

    it("says a declined balance needs attention rather than printing its date as a deadline", async () => {
      // Nothing is queued in `action_required` — the charge already ran and was
      // declined — so a panel with no way to tell the two apart shows a date
      // that has passed and a customer waits for a charge that will not come.
      await sql`
        update app.planning_org_orders set state = 'action_required'
        where event_id = ${sarahsThirtiethId}
          and balance_amount > 0 and balance_due_at is not null
          and balance_due_at = (
            select min(balance_due_at) from app.planning_org_orders
            where event_id = ${sarahsThirtiethId} and balance_amount > 0
          )
      `;

      const hub = await eventHub(ctx, sarah, sarahsThirtiethId);
      expect(hub.payments.nextChargeStatus).toBe("attention");
      expect(hub.payments.nextCharge).toBeGreaterThan(0n);
    });

    it("has nothing to take once every booking is paid for or gone", async () => {
      await sql`
        update app.planning_org_orders set state = 'cancelled'
        where event_id = ${sarahsThirtiethId}
      `;

      const hub = await eventHub(ctx, sarah, sarahsThirtiethId);
      expect(hub.payments.nextChargeAt).toBeNull();
      expect(hub.payments.nextCharge).toBe(0n);
      expect(hub.payments.nextChargeStatus).toBeNull();
    });

    it("sums what actually settled rather than what the orders say is due", async () => {
      const [settled] = await sql<{ total: string }[]>`
        select coalesce(sum(p.amount), 0)::text as total
        from app.planning_org_payments p
        join app.planning_org_orders o on o.id = p.order_id
        where o.event_id = ${sarahsThirtiethId} and p.state = 'succeeded'
      `;

      const hub = await eventHub(ctx, sarah, sarahsThirtiethId);
      expect(hub.payments.captured).toBe(BigInt(settled?.total as string));
    });
  });

  describe("the colour a slot is drawn in", () => {
    it("comes from the category, whatever an administrator has set it to", async () => {
      // The planner draws a tile per slot in its category's own gradient. Six
      // pairs copied into the screen would be right until somebody edited one,
      // and wrong silently afterwards — so the value travels with the slot.
      const tones = new Map(
        (
          await sql<{ id: string; tone: string | null }[]>`
            select id, tone from app.planning_org_categories
          `
        ).map((row) => [row.id, row.tone]),
      );

      const before = await eventHub(ctx, sarah, sarahsThirtiethId);
      expect(before.items.length).toBeGreaterThan(0);
      for (const item of before.items) {
        expect(item.categoryTone).toBe(tones.get(item.categoryId));
      }

      await sql`
        update app.planning_org_categories
        set tone = 'linear-gradient(140deg, #000000, #FFFFFF)'
        where id = ${cakesCategoryId}
      `;

      const after = await eventHub(ctx, sarah, sarahsThirtiethId);
      const cakes = after.items.find((item) => item.categoryId === cakesCategoryId);
      expect(cakes?.categoryTone).toBe("linear-gradient(140deg, #000000, #FFFFFF)");
    });
  });

  describe("the day of the event", () => {
    it("leads with venue access and orders the arrivals", async () => {
      const flowersCategoryId = await one(
        sql`select id from app.planning_org_categories where slug = 'flowers'`,
      );
      const flowerServiceId = await one(sql`
        select s.id from app.planning_org_services s
        join app.planning_org_vendors v on v.id = s.vendor_id
        where v.status = 'approved' and s.category_id = ${flowersCategoryId} limit 1
      `);

      await addItemToPlan(ctx, sarah, {
        eventId: sarahsThirtiethId,
        serviceId: cakeServiceId,
        arrivalTime: "18:30",
      });
      await addItemToPlan(ctx, sarah, {
        eventId: sarahsThirtiethId,
        serviceId: flowerServiceId,
        arrivalTime: "16:30",
      });

      const hub = await eventHub(ctx, sarah, sarahsThirtiethId);

      expect(hub.schedule[0]).toMatchObject({
        kind: "venue",
        venueName: "Liberty Village loft",
      });
      expect(hub.schedule.slice(1).map((entry) => entry.time)).toEqual(["16:30:00", "18:30:00"]);
    });

    it("leaves out a slot with no arrival time", async () => {
      await addItemToPlan(ctx, sarah, {
        eventId: sarahsThirtiethId,
        serviceId: cakeServiceId,
      });

      const hub = await eventHub(ctx, sarah, sarahsThirtiethId);
      expect(hub.schedule.filter((entry) => entry.kind === "arrival")).toEqual([]);
    });
  });

  describe("changing an event", () => {
    it("saves a guest count while a booking is live", async () => {
      const updated = await updateEvent(ctx, sarah, sarahsThirtiethId, { guestCount: 64 });
      expect(updated.guestCount).toBe(64);
    });

    it("refuses a date change while a booking is live, naming it", async () => {
      await expect(
        updateEvent(ctx, sarah, sarahsThirtiethId, { eventDate: "2027-04-01" }),
      ).rejects.toThrow(/TO-419/);

      const [row] = await sql<{ day: string }[]>`
        select event_date::text as day from app.planning_org_events
        where id = ${sarahsThirtiethId}
      `;
      expect(row?.day).not.toBe("2027-04-01");
    });

    it("refuses a date change for a checkout still in flight", async () => {
      // Not only a confirmed booking. A checkout mid-flight holds the date, and
      // moving it would have the webhook confirm an order whose balance is
      // scheduled on the new date while its block sits on the old one.
      await sql`
        update app.planning_org_orders set state = 'pending_payment'
        where event_id = ${sarahsThirtiethId}
      `;

      await expect(
        updateEvent(ctx, sarah, sarahsThirtiethId, { eventDate: "2027-04-02" }),
      ).rejects.toThrow(ValidationError);
    });

    it("allows a date change once every booking has ended", async () => {
      // `completed`, `cancelled` and `refunded` constrain nothing: their dates
      // are spent or given back.
      await sql`
        update app.planning_org_orders set state = 'completed' where event_id = ${sarahsThirtiethId}
      `;

      const moved = await updateEvent(ctx, sarah, sarahsThirtiethId, { eventDate: "2027-04-03" });
      expect(moved.eventDate).toBe("2027-04-03");
    });

    it("holds the refusal against a booking arriving at the same moment", async () => {
      // The claim the lock exists for. The event starts with nothing live
      // against it, so without the lock the date change reads an empty order
      // list and commits — while a confirm lands on the old date.
      await sql`
        update app.planning_org_orders set state = 'completed' where event_id = ${babyShowerId}
      `;

      let settled = false;
      let change: Promise<unknown> | undefined;

      await sql.begin(async (tx) => {
        // Exactly the lock the date change takes, from another connection.
        await tx`select id from app.planning_org_events where id = ${babyShowerId} for update`;

        change = updateEvent(ctx, sarah, babyShowerId, { eventDate: "2027-09-09" });
        // Swallowed here and awaited below: an unhandled rejection while this
        // transaction is open would fail the run somewhere else entirely.
        void change.then(
          () => {
            settled = true;
          },
          () => {
            settled = true;
          },
        );

        await wait(SETTLE_MS);
        expect(settled, "the date change did not wait for the event row").toBe(false);

        // The booking lands while the change is blocked.
        await tx`
          update app.planning_org_orders set state = 'confirmed'
          where event_id = ${babyShowerId}
        `;
      });

      // It read the orders after the confirm committed, so it sees the live one
      // and refuses, naming it.
      await expect(change).rejects.toThrow(ValidationError);

      const [row] = await sql<{ day: string }[]>`
        select event_date::text as day from app.planning_org_events where id = ${babyShowerId}
      `;
      expect(row?.day).not.toBe("2027-09-09");
    });
  });

  describe("closing an event", () => {
    it("writes a timestamp and deletes nothing", async () => {
      await sql`
        update app.planning_org_orders set state = 'completed' where event_id = ${babyShowerId}
      `;

      const closed = await cancelEvent(ctx, sarah, babyShowerId);
      expect(closed.cancelledAt).toBeInstanceOf(Date);

      const [row] = await sql<{ n: number }[]>`
        select count(*)::int as n from app.planning_org_events where id = ${babyShowerId}
      `;
      expect(row?.n).toBe(1);

      const [orders] = await sql<{ n: number }[]>`
        select count(*)::int as n from app.planning_org_orders where event_id = ${babyShowerId}
      `;
      expect(orders?.n).toBeGreaterThan(0);
    });

    it("refuses while a booking is live", async () => {
      await expect(cancelEvent(ctx, sarah, sarahsThirtiethId)).rejects.toThrow(ValidationError);
    });

    it("refuses to close one twice", async () => {
      await sql`
        update app.planning_org_orders set state = 'completed' where event_id = ${babyShowerId}
      `;
      await cancelEvent(ctx, sarah, babyShowerId);

      await expect(cancelEvent(ctx, sarah, babyShowerId)).rejects.toThrow(ValidationError);
    });
  });

  describe("the schema this needs", () => {
    it("offers three visibilities, with the seeded rows spread across them", async () => {
      const values = await sql<{ value: string }[]>`
        select unnest(enum_range(null::app.event_visibility))::text as value
      `;
      expect(values.map((row) => row.value)).toEqual(["private", "shared", "public"]);

      // The migration added the value and changed no row. Every event's
      // visibility is one the seed wrote deliberately.
      const [unexpected] = await sql<{ n: number }[]>`
        select count(*)::int as n from app.planning_org_events where visibility is null
      `;
      expect(unexpected?.n).toBe(0);
    });

    it("carries what an item in plan actually holds", async () => {
      const columns = await sql<{ name: string }[]>`
        select column_name as name from information_schema.columns
        where table_schema = 'app' and table_name = 'planning_org_event_items'
          and column_name in ('service_package_id', 'quantity', 'arrival_time')
        order by column_name
      `;
      expect(columns.map((row) => row.name)).toEqual([
        "arrival_time",
        "quantity",
        "service_package_id",
      ]);
    });

    it("knows what an item points at", async () => {
      // The three keys the table never had. Without them an item could name an
      // order, a package or a category the database has never heard of.
      const keys = await sql<{ name: string }[]>`
        select conname as name from pg_constraint
        where conrelid = 'app.planning_org_event_items'::regclass and contype = 'f'
        order by conname
      `;
      const names = keys.map((row) => row.name);

      expect(names).toContain("planning_org_event_items_order_id_fk");
      expect(names).toContain("planning_org_event_items_category_id_fk");
      expect(names).toContain("planning_org_event_items_service_package_id_fk");
    });

    it("refuses a quantity below one", async () => {
      await expect(
        sql`
          update app.planning_org_event_items set quantity = 0
          where event_id = ${sarahsThirtiethId} and category_id = ${cakesCategoryId}
        `,
      ).rejects.toThrow(/event_items_quantity_positive/);
    });

    it("keeps the slot when its order is deleted", async () => {
      // `ON DELETE SET NULL`, not `CASCADE`. The demo reset deletes orders
      // before event items, and a plain key would refuse that statement
      // outright — while a cascade would take the customer's slot with it.
      const flowersCategoryId = await one(
        sql`select id from app.planning_org_categories where slug = 'flowers'`,
      );
      const orderId = await one(
        sql`select id from app.planning_org_orders where reference = 'TO-4192'`,
      );
      await sql`
        update app.planning_org_event_items set order_id = ${orderId}
        where event_id = ${sarahsThirtiethId} and category_id = ${flowersCategoryId}
      `;

      await sql`delete from app.planning_org_payments where order_id = ${orderId}`;
      await sql`delete from app.planning_org_transfers where order_id = ${orderId}`;
      await sql`delete from app.planning_org_capacity_blocks where order_id = ${orderId}`;
      // A job names its order in its dedupe key rather than in a column.
      await sql`delete from app.planning_org_jobs where dedupe_key like ${"%" + orderId}`;
      await sql`delete from app.planning_org_order_items where order_id = ${orderId}`;
      await sql`delete from app.planning_org_orders where id = ${orderId}`;

      const [row] = await sql<{ n: number; order_id: string | null }[]>`
        select count(*)::int as n, min(order_id::text) as order_id
        from app.planning_org_event_items
        where event_id = ${sarahsThirtiethId} and category_id = ${flowersCategoryId}
      `;
      expect(row?.n).toBe(1);
      expect(row?.order_id).toBeNull();
    });
  });

  describe("what the seed writes", () => {
    it("gives every seeded event one empty slot per category", async () => {
      const expected = await activeCategoryCount();

      const rows = await sql<{ name: string; slots: number; filled: number }[]>`
        select e.name,
               count(i.id)::int as slots,
               count(i.id) filter (
                 where i.service_id is not null or i.order_id is not null
                    or i.quote_request_id is not null or i.arrival_time is not null
               )::int as filled
        from app.planning_org_events e
        join app.planning_org_event_items i on i.event_id = e.id
        group by e.name
      `;

      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect([row.name, row.slots]).toEqual([row.name, expected]);
        // Structure only. The slot states belong to the phase that owns the
        // rest of these screens, and both writing them here would collide.
        expect([row.name, row.filled]).toEqual([row.name, 0]);
      }
    });

    it("makes a second slot for one category impossible rather than silent", async () => {
      // The seed's prevailing `.onConflictDoNothing()` would swallow a conflict
      // on the category key as well as the primary one, so a later pass writing
      // real slot states would lose without saying so.
      await expect(
        sql`
          insert into app.planning_org_event_items (event_id, category_id)
          values (${babyShowerId}, ${cakesCategoryId})
        `,
      ).rejects.toThrow(/event_items_event_category_key/);
    });
  });
});
