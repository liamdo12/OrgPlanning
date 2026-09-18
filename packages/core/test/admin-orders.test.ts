import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type postgres from "postgres";
import type { Actor } from "../src/identity/actor.js";
import type { CoreContext } from "../src/context.js";
import { NotFoundError, ValidationError } from "../src/errors.js";
import { getActor } from "../src/identity/service.js";
import {
  getOrderDetail,
  listOrderVendors,
  listOrdersForAdmin,
  markOrderFulfilled,
  recordDashboardRefund,
  refundCoolingWindow,
  resolveOrderIssue,
  retryBalance,
} from "../src/ordering/admin-service.js";
import { KIND_FOR_FILTER, PAYMENT_FILTERS } from "../src/ordering/admin-repo.js";
import { createCheckout, getOrder, raiseIssue } from "../src/ordering/service.js";
import * as ordering from "../src/ordering/repo.js";
import * as payments from "../src/payments/repo.js";
import {
  applyWebhook,
  chargeBalance,
  chargeDeposit,
  transferShare,
} from "../src/payments/service.js";
import type { StripeFake } from "../src/testing/stripe-fake.js";
import { createStripeFake } from "../src/testing/stripe-fake.js";
import { createDatabaseContext, ownerSql, resetDatabase, testDatabaseUrl } from "./harness.js";

/**
 * The admin orders screen, against the seeded platform.
 *
 * The claims here are the ones a unit test cannot make. That the payment label
 * and the SQL filter behind it agree — they are two expressions of one rule and
 * the second one runs over rows the first never sees. That the list costs a
 * fixed number of queries however many orders are on it. That marking an order
 * delivered actually queues the job that completes it. And that a vendor or a
 * customer reaching any of this is refused, which is the whole reason there are
 * two layers of authorization rather than a role check.
 */

const url = testDatabaseUrl();

describe.skipIf(!url)("admin orders", () => {
  const dbUrl = url as string;
  let sql: postgres.Sql;
  let database: ReturnType<typeof createDatabaseContext>;
  let ctx: CoreContext;
  let stripe: StripeFake;
  let admin: Actor;
  let customer: Actor;
  let vendorStaff: Actor;
  /** Every statement the pool has issued since `queries.length = 0`. */
  let queries: string[];

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
    queries = [];
    database = createDatabaseContext(dbUrl, stripe, (query) => queries.push(query));
    ctx = database.ctx;

    await sql`
      update app.planning_org_users
      set auth_provider_sub = 'provider-sub-' || email
    `;

    admin = await actorFor("admin@occasion.test");
    customer = await actorFor("sarah@example.ca");
    vendorStaff = await actorFor("rosa@bloomandco.ca");
  });

  /** Builds an actor the way a first sign-in would. */
  async function actorFor(email: string): Promise<Actor> {
    const [row] = await sql<{ id: string }[]>`
      select id from app.planning_org_users where email = ${email}
    `;
    if (!row) throw new Error(`no seeded account for ${email}`);

    database.setUser({
      id: `provider-sub-${email}`,
      email,
      emailVerified: true,
      issuedAt: new Date(),
      secondFactorVerified: true,
    });

    return getActor(ctx);
  }

  async function orderByReference(reference: string) {
    const order = await ordering.loadByReference(ctx.db, reference);
    if (!order) throw new Error(`no seeded order ${reference}`);
    return order;
  }

  /**
   * A booking made through the domain rather than lifted from the seed.
   *
   * The seeded rows carry provider ids the fake has never issued, so anything
   * that has to *talk* to the provider — retrying a balance, refunding a charge
   * — has to start from a booking this suite actually made. The seeded orders
   * stay where they are useful: reading, labelling and filtering.
   */
  async function bookAndPayDeposit() {
    const [event] = await sql<{ id: string }[]>`
      insert into app.planning_org_events (owner_user_id, name, event_date, start_time, timezone)
      values (
        (select id from app.planning_org_users where email = 'sarah@example.ca'),
        'Fresh booking',
        (now() + interval '60 days')::date,
        '17:00',
        'America/Toronto'
      )
      returning id
    `;

    const [service] = await sql<{ id: string }[]>`
      select s.id
      from app.planning_org_services s
      join app.planning_org_vendors v on v.id = s.vendor_id
      where v.slug = 'bloom-and-co' and v.status = 'approved'
      limit 1
    `;

    // A payout needs a connected account, and the seeded placeholder is not one
    // the fake has issued.
    await sql`
      update app.planning_org_vendors
      set stripe_account_id = 'acct_test_' || left(id::text, 8),
          stripe_payouts_enabled_at = now()
      where status = 'approved'
    `;

    const checkout = await createCheckout(ctx, customer, {
      eventId: event?.id as string,
      lines: [{ serviceId: service?.id as string, quantity: 4 }],
    });
    const order = checkout.orders[0] as NonNullable<(typeof checkout.orders)[number]>;

    const deposit = await chargeDeposit(ctx, customer, order.id);
    stripe.settleCheckoutSession(deposit.providerPaymentIntentId);
    const intent = await stripe.retrievePaymentIntent(deposit.providerPaymentIntentId);
    await applyWebhook(ctx, {
      type: "payment_intent.succeeded",
      object: {
        id: deposit.providerPaymentIntentId,
        latest_charge: intent?.chargeId,
        metadata: { order_id: order.id, payment_id: deposit.paymentId },
      },
    });

    return order;
  }

  describe("the list", () => {
    it("shows the seeded orders with the labels the prototype draws", async () => {
      const list = await listOrdersForAdmin(ctx, admin);
      const byReference = new Map(list.rows.map((row) => [row.reference, row]));

      // Lines 2723–2728, every row of the prototype's own list.
      expect(byReference.get("TO-4192")?.payment.label).toBe("Deposit C$65.54");
      expect(byReference.get("TO-4192")?.stateLabel).toBe("confirmed");
      expect(byReference.get("TO-4192")?.who).toBe("Bloom & Co · Sarah's 30th");
      expect(byReference.get("TO-4192")?.total).toBe("C$327.70");

      expect(byReference.get("TO-4188")?.payment.label).toBe("Paid in full");
      expect(byReference.get("TO-4188")?.stateLabel).toBe("fulfilled");

      expect(byReference.get("TO-4181")?.payment.label).toBe("Balance failed");
      expect(byReference.get("TO-4181")?.stateLabel).toBe("action req.");

      expect(byReference.get("TO-4171")?.payment.label).toBe("Refunded");
      expect(byReference.get("TO-4171")?.stateLabel).toBe("cancelled");

      expect(byReference.get("TO-4165")?.payment.label).toBe("Paid in full");
      expect(byReference.get("TO-4165")?.stateLabel).toBe("completed");
    });

    it("costs the same number of queries whatever the page holds", async () => {
      // The claim an assertion on the output cannot make. A label that fetched
      // its own payments per row would return exactly the same list and cost
      // twenty-five extra round trips — and would only be noticed in production.
      const first = await listOrdersForAdmin(ctx, admin);
      expect(first.rows.length).toBeGreaterThan(3);

      queries.length = 0;
      await listOrdersForAdmin(ctx, admin);

      // The count, and the page. Nothing per row.
      expect(queries).toHaveLength(2);
    });

    it("agrees with the label on every payment filter", async () => {
      // Two expressions of one rule: `paymentLabel` decides in TypeScript over
      // a row that was fetched, and the filter decides in SQL over rows that
      // never are. Nothing but this holds them together.
      for (const filter of PAYMENT_FILTERS) {
        const list = await listOrdersForAdmin(ctx, admin, { payment: filter });
        for (const row of list.rows) {
          expect([filter, row.reference, row.payment.kind]).toEqual([
            filter,
            row.reference,
            KIND_FOR_FILTER[filter],
          ]);
        }
      }
    });

    it("agrees on an order that two labels could describe", async () => {
      // The seed has no order that is both refunded and balance-failed, so the
      // parity above never exercises the precedence: both expressions of the
      // rule could disagree about which label wins and still return the same
      // rows. TO-4181's balance declined; refunding its deposit makes it both.
      const order = await orderByReference("TO-4181");
      await recordDashboardRefund(ctx, admin, order.id, {
        providerRefundId: "re_testboth",
        amount: (await getOrderDetail(ctx, admin, order.id)).money.netCapturedCents,
        reason: "Refunded after the balance failed.",
      });

      const detail = await getOrderDetail(ctx, admin, order.id);
      expect(detail.order.payment.kind).toBe("refunded");

      const refunded = await listOrdersForAdmin(ctx, admin, { payment: "refunded" });
      expect(refunded.rows.map((row) => row.reference)).toContain("TO-4181");

      const failed = await listOrdersForAdmin(ctx, admin, { payment: "balance-failed" });
      expect(failed.rows.map((row) => row.reference)).not.toContain("TO-4181");
    });

    it("accounts for every order across the five filters exactly once", async () => {
      // The other half of the parity: agreeing on what each filter returns is
      // not enough if between them they miss an order or claim one twice.
      const everything = await listOrdersForAdmin(ctx, admin);
      const seen: string[] = [];

      for (const filter of PAYMENT_FILTERS) {
        const list = await listOrdersForAdmin(ctx, admin, { payment: filter });
        seen.push(...list.rows.map((row) => row.reference));
      }

      expect(seen.slice().sort()).toEqual(everything.rows.map((row) => row.reference).sort());
    });

    it("narrows by state, by vendor and by search", async () => {
      const confirmed = await listOrdersForAdmin(ctx, admin, { state: "confirmed" });
      expect(confirmed.rows.every((row) => row.state === "confirmed")).toBe(true);
      expect(confirmed.rows.map((row) => row.reference).sort()).toEqual(["TO-4191", "TO-4192"]);

      const vendors = await listOrderVendors(ctx, admin);
      const bloom = vendors.find((vendor) => vendor.name === "Bloom & Co");
      const byVendor = await listOrdersForAdmin(ctx, admin, { vendorId: bloom?.id });
      expect(byVendor.rows.map((row) => row.reference).sort()).toEqual(["TO-4188", "TO-4192"]);

      // The reference off an email, the business, the event, the customer.
      expect((await listOrdersForAdmin(ctx, admin, { search: "TO-4181" })).total).toBe(1);
      expect((await listOrdersForAdmin(ctx, admin, { search: "Kimchi" })).total).toBe(1);
      expect((await listOrdersForAdmin(ctx, admin, { search: "Okafor wedding" })).total).toBe(1);
      expect((await listOrdersForAdmin(ctx, admin, { search: "sarah@example.ca" })).total).toBe(4);
    });

    it("does not treat a wildcard in a search term as syntax", async () => {
      // Unescaped, `%` matches every order rather than none, and the screen
      // would quietly answer a question nobody asked.
      expect((await listOrdersForAdmin(ctx, admin, { search: "%" })).total).toBe(0);
    });

    it("refuses a malformed date rather than ignoring it", async () => {
      // The one filter that is not dropped when it is unrecognisable: silently
      // ignoring it would show every order under a heading claiming a range.
      await expect(listOrdersForAdmin(ctx, admin, { from: "18-09-2026" })).rejects.toThrow(
        ValidationError,
      );
    });

    it("falls back to the whole list for a filter that is not a filter", async () => {
      const everything = await listOrdersForAdmin(ctx, admin);
      const nonsense = await listOrdersForAdmin(ctx, admin, {
        state: "exploded",
        payment: "vibes",
        vendorId: "not-a-uuid",
      });

      expect(nonsense.total).toBe(everything.total);
    });

    it("pages without repeating or dropping a row", async () => {
      // Thirty orders in **one statement**, so they share `now()` to the
      // microsecond — which is what a multi-vendor checkout does, and the case
      // the cursor's tiebreak exists for. With seven seeded orders that is two
      // full pages and a remainder.
      //
      // Written as rows rather than through `createCheckout`: the property
      // under test is the cursor, and thirty bookings would need thirty free
      // dates on one vendor's calendar to get past the capacity constraint.
      await sql`
        insert into app.planning_org_orders (
          reference, user_id, vendor_id, state,
          subtotal, tax, total, commission, commission_tax,
          deposit_amount, balance_amount, currency, cooling_window_ends_at
        )
        select
          'TO-9' || lpad(n::text, 3, '0'),
          (select id from app.planning_org_users where email = 'sarah@example.ca'),
          (select id from app.planning_org_vendors where slug = 'bloom-and-co'),
          'confirmed',
          10000, 1300, 11300, 1000, 130, 2260, 9040, 'CAD', now() + interval '2 days'
        from generate_series(1, 30) as n
      `;

      const everything = await listOrdersForAdmin(ctx, admin);
      expect(everything.total).toBe(37);

      const seen: string[] = [];
      let cursor: string | undefined;
      let pages = 0;

      do {
        const page = await listOrdersForAdmin(ctx, admin, { ...(cursor ? { cursor } : {}) });
        seen.push(...page.rows.map((row) => row.reference));
        cursor = page.nextCursor;
        pages += 1;
        // A cursor that never advances would otherwise spin here rather than
        // fail, and the failure would be a timeout naming nothing.
        expect(pages).toBeLessThan(10);
      } while (cursor);

      expect(pages).toBeGreaterThan(1);
      // Every order is reachable, exactly once. Before the cursor carried the
      // instant at full precision this returned 32 of the 37: five orders were
      // unreachable from the screen at any page, with no error and no log.
      expect(new Set(seen).size).toBe(seen.length);
      expect(seen).toHaveLength(37);
    });

    it("starts again rather than failing on a cursor somebody edited", async () => {
      const page = await listOrdersForAdmin(ctx, admin, { cursor: "not-a-cursor" });
      expect(page.rows.length).toBeGreaterThan(0);
    });

    it("refuses a customer and a vendor's staff", async () => {
      await expect(listOrdersForAdmin(ctx, customer)).rejects.toThrow();
      await expect(listOrdersForAdmin(ctx, vendorStaff)).rejects.toThrow();
    });
  });

  describe("the record", () => {
    it("carries the money, the payments and the terms", async () => {
      const order = await orderByReference("TO-4192");
      const detail = await getOrderDetail(ctx, admin, order.id);

      expect(detail.money.total).toBe("C$327.70");
      expect(detail.money.deposit).toBe("C$65.54");
      expect(detail.money.netCaptured).toBe("C$65.54");
      expect(detail.customer.email).toBe("sarah@example.ca");
      expect(detail.vendor.name).toBe("Bloom & Co");
      expect(detail.event?.name).toBe("Sarah's 30th");
      expect(detail.payments).toHaveLength(1);
      expect(detail.policy?.depositBps).toBe(2_000);
    });

    it("reads a fully refunded order as holding nothing", async () => {
      // The figure that bounds a dashboard-refund entry and decides whether a
      // payout still has funds behind it. Counting only `succeeded` payments
      // subtracts the same refund twice and reads this order as owing money.
      const order = await orderByReference("TO-4171");
      const detail = await getOrderDetail(ctx, admin, order.id);

      expect(detail.money.netCapturedCents).toBe(0n);
      expect(detail.order.payment.label).toBe("Refunded");
    });

    it("finds the work the seed queued against it", async () => {
      // The seed writes its own job rows and cannot import the domain, so it
      // repeats the `type:orderId` key convention. Nothing but this holds the
      // two together — and a seeded job under a different key is one the domain
      // can neither cancel when the order ends nor recognise as a duplicate
      // when the same work is queued again.
      const order = await orderByReference("TO-4192");
      const jobs = await ordering.listJobsForOrder(ctx.db, order.id);

      expect(jobs.map((job) => job.type).sort()).toEqual([
        "charge_balance",
        "cooling_window_transfer",
      ]);

      // And ending the order calls them off, which is the consequence that was
      // silently not happening.
      await refundCoolingWindow(ctx, admin, order.id);
      const after = await ordering.listJobsForOrder(ctx.db, order.id);
      expect(after.every((job) => job.status === "done")).toBe(true);
    });

    it("refuses an id that is not one", async () => {
      await expect(getOrderDetail(ctx, admin, "nonsense")).rejects.toThrow(NotFoundError);
    });

    it("refuses a customer reading their own order through the admin screen", async () => {
      // The role gate, not the object policy: this is the administrative view,
      // and a customer has their own.
      const order = await orderByReference("TO-4192");
      await expect(getOrderDetail(ctx, customer, order.id)).rejects.toThrow();
    });

    it("refuses a vendor's staff, whichever order it is", async () => {
      // The role gate, before the object policy gets a look: this screen is
      // administrative, and a vendor has their own.
      await expect(
        getOrderDetail(ctx, vendorStaff, (await orderByReference("TO-4192")).id),
      ).rejects.toThrow();
    });

    it("lets the object policy refuse another vendor's order on the shared path", async () => {
      // The check that matters for the vendor-facing screen this milestone does
      // not build: `getOrder` is the function it will call, and a role check
      // alone would hand Bloom's staff a booking with Kimchi Kart.
      const own = await orderByReference("TO-4192");
      await expect(getOrder(ctx, vendorStaff, own.id)).resolves.toBeTruthy();

      const other = await orderByReference("TO-4181");
      // `NotFoundError`, not forbidden: a refusal that confirmed the row exists
      // would turn an id parameter into an enumeration oracle.
      await expect(getOrder(ctx, vendorStaff, other.id)).rejects.toThrow(NotFoundError);
    });
  });

  describe("what the record offers", () => {
    it("offers only the moves the lifecycle allows", async () => {
      const confirmed = await getOrderDetail(ctx, admin, (await orderByReference("TO-4192")).id);
      expect(confirmed.actions.fulfil).toBe(true);
      expect(confirmed.actions.retryBalance).toBe(false);
      expect(confirmed.actions.resolveIssue).toBe(false);

      const waiting = await getOrderDetail(ctx, admin, (await orderByReference("TO-4181")).id);
      expect(waiting.actions.retryBalance).toBe(true);

      const finished = await getOrderDetail(ctx, admin, (await orderByReference("TO-4165")).id);
      expect(finished.actions.fulfil).toBe(false);
      expect(finished.actions.refundInApp).toBe(false);
    });

    it("does not offer a way out of an issue that records nothing", async () => {
      // The lifecycle allows `issue → fulfilled`, and resolving an issue
      // requires a note. A "Mark fulfilled" button on a flagged order would be
      // the same move with no note, so the record offers only the resolve path
      // — which has `fulfilled` among its destinations.
      const order = await orderByReference("TO-4192");
      await raiseIssue(ctx, admin, order.id, "The flowers arrived wilted.");

      const detail = await getOrderDetail(ctx, admin, order.id);
      expect(detail.actions.fulfil).toBe(false);
      expect(detail.actions.resolveIssue).toBe(true);
      expect(detail.actions.resolutions).toContain("fulfilled");
    });

    it("says why the in-app refund is unavailable rather than hiding it", async () => {
      // TO-4188's window closed a month ago. An administrator who cannot find
      // the button needs to be told where the refund is made instead.
      const detail = await getOrderDetail(ctx, admin, (await orderByReference("TO-4188")).id);

      expect(detail.actions.refundInApp).toBe(false);
      expect(detail.actions.refundBlocked).toMatch(/Stripe dashboard/);
    });
  });

  describe("the actions", () => {
    it("queues the auto-complete when an order is marked delivered", async () => {
      // The reason this action exists in this milestone: entering `fulfilled`
      // is what schedules the job that completes the order and releases the
      // vendor's balance share, and a lifecycle whose only route into that
      // state is a seeded row is one nobody has ever run.
      const order = await orderByReference("TO-4192");
      const change = await markOrderFulfilled(ctx, admin, order.id);

      expect(change.to).toBe("fulfilled");
      expect(change.jobsQueued).toContain("auto_complete_order");

      const jobs = await ordering.listJobsForOrder(ctx.db, order.id);
      const autoComplete = jobs.find((job) => job.type === "auto_complete_order");
      expect(autoComplete?.status).toBe("queued");

      // Seventy-two hours after the event ends, not after now.
      const [event] = await sql<{ event_date: string }[]>`
        select event_date::text from app.planning_org_events
        where id = ${order.eventId as string}
      `;
      const endOfDay = new Date(`${event?.event_date}T00:00:00-04:00`);
      endOfDay.setUTCDate(endOfDay.getUTCDate() + 1);
      const due = autoComplete?.runAfter as Date;
      expect(due.getTime() - endOfDay.getTime()).toBe(72 * 3_600_000);
    });

    it("refuses to mark an order delivered from a state that cannot", async () => {
      const order = await orderByReference("TO-4171");
      await expect(markOrderFulfilled(ctx, admin, order.id)).rejects.toThrow(ValidationError);
    });

    it("retries a declined balance without charging twice", async () => {
      const order = await bookAndPayDeposit();

      stripe.declineNextCharge();
      expect((await chargeBalance(ctx, admin, order.id)).outcome).toBe("action_required");

      // Retried with a card that works, on the same order, from the screen.
      const result = await retryBalance(ctx, admin, order.id);
      expect(result.outcome).toBe("captured");
      expect((await ordering.load(ctx.db, order.id))?.state).toBe("confirmed");

      const settled = (await payments.listPayments(ctx.db, order.id)).filter(
        (payment) => payment.kind === "balance" && payment.state === "succeeded",
      );
      expect(settled).toHaveLength(1);

      // A second press finds an order that is no longer waiting for a balance
      // rather than opening a second charge on somebody's card.
      await expect(retryBalance(ctx, admin, order.id)).rejects.toThrow(ValidationError);
      expect(
        (await payments.listPayments(ctx.db, order.id)).filter(
          (payment) => payment.kind === "balance" && payment.state === "succeeded",
        ),
      ).toHaveLength(1);
    });

    it("does not hand the payment link to the admin screen", async () => {
      // The token is a bearer credential for a payment — whoever holds it can
      // complete the charge — and it reaches the customer by email. Returning
      // it here would put it in a screenshot and a support ticket.
      const order = await bookAndPayDeposit();
      stripe.declineNextCharge();
      await chargeBalance(ctx, admin, order.id);

      stripe.declineNextCharge();
      const result = await retryBalance(ctx, admin, order.id);
      expect(result.outcome).toBe("action_required");
      expect(result.linkReissued).toBe(true);
      expect(JSON.stringify(result)).not.toMatch(/token/i);
    });

    it("requires a note to resolve an issue, and records it", async () => {
      const order = await orderByReference("TO-4192");
      await raiseIssue(ctx, admin, order.id, "The flowers arrived wilted.");

      await expect(resolveOrderIssue(ctx, admin, order.id, "confirmed", "   ")).rejects.toThrow(
        ValidationError,
      );

      const change = await resolveOrderIssue(
        ctx,
        admin,
        order.id,
        "confirmed",
        "Vendor replaced them the same afternoon.",
      );
      expect(change.to).toBe("confirmed");

      // The order's own note is cleared — the problem is over — and what
      // somebody needs later is on the history instead.
      expect((await ordering.load(ctx.db, order.id))?.issueNote).toBeNull();

      const detail = await getOrderDetail(ctx, admin, order.id);
      const entry = detail.audit.find((row) => row.action === "order.resolve_issue");
      expect((entry?.after as { resolution?: string }).resolution).toBe(
        "Vendor replaced them the same afternoon.",
      );
    });

    it("refuses to resolve an issue to a state the lifecycle does not allow", async () => {
      const order = await orderByReference("TO-4192");
      await raiseIssue(ctx, admin, order.id, "Something is wrong.");

      await expect(
        resolveOrderIssue(ctx, admin, order.id, "refunded", "Because I said so."),
      ).rejects.toThrow(ValidationError);
    });

    it("refunds inside the cooling window and puts the date back", async () => {
      const order = await bookAndPayDeposit();
      const held = await ordering.listCapacityBlocks(ctx.db, order.id);
      expect(held.some((block) => block.active)).toBe(true);

      const refunds = await refundCoolingWindow(ctx, admin, order.id);
      expect(refunds.filter((refund) => refund.state === "settled")).toHaveLength(1);
      expect((await ordering.load(ctx.db, order.id))?.state).toBe("refunded");
      expect(
        (await ordering.listCapacityBlocks(ctx.db, order.id)).some((block) => block.active),
      ).toBe(false);

      const detail = await getOrderDetail(ctx, admin, order.id);
      expect(detail.order.payment.label).toBe("Refunded");
      expect(detail.money.netCapturedCents).toBe(0n);
    });

    it("refuses an in-app refund once the window has closed", async () => {
      // TO-4188's deposit was taken a month ago, so its free window is long
      // over and its share has been transferred. The answer points at the
      // dashboard rather than silently doing a partial refund.
      const order = await orderByReference("TO-4188");
      await expect(refundCoolingWindow(ctx, admin, order.id)).rejects.toThrow(ValidationError);
    });

    it("records a dashboard refund and reconciles the order", async () => {
      const order = await orderByReference("TO-4188");
      const before = await getOrderDetail(ctx, admin, order.id);

      const result = await recordDashboardRefund(ctx, admin, order.id, {
        providerRefundId: "re_testmanual",
        amount: 50_000n,
        reason: "Partial refund agreed with the customer.",
      });

      expect(result.amount).toBe("C$500.00");

      const after = await getOrderDetail(ctx, admin, order.id);
      expect(after.money.netCapturedCents).toBe(before.money.netCapturedCents - 50_000n);
      // A partial refund says how much went back rather than reading as
      // settled while the order still holds most of the customer's money.
      expect(after.order.payment.label).toBe("Refunded C$500.00");
      expect(after.audit.some((row) => row.action === "payment.record_external_refund")).toBe(true);
    });

    it("does not let a flagged refund be recorded twice", async () => {
      // A refund made after the vendor's share has left is settled *and*
      // flagged for somebody to reverse the transfer. Counting only settled
      // refunds leaves the order reading as though it still holds the money,
      // and a second full refund can then be recorded against it.
      const order = await bookAndPayDeposit();
      const transfer = await transferShare(ctx, admin, order.id, "deposit_share");
      expect(transfer.state).toBe("paid");

      const captured = (await getOrderDetail(ctx, admin, order.id)).money.netCapturedCents;

      const first = await recordDashboardRefund(ctx, admin, order.id, {
        providerRefundId: "re_testflagged",
        amount: captured,
        reason: "Refunded in the dashboard after the payout had gone.",
      });
      expect(first.needsAttention).toBe(true);

      const after = await getOrderDetail(ctx, admin, order.id);
      expect(after.money.netCapturedCents).toBe(0n);

      await expect(
        recordDashboardRefund(ctx, admin, order.id, {
          providerRefundId: "re_testflaggedagain",
          amount: captured,
          reason: "And again.",
        }),
      ).rejects.toThrow(ValidationError);
    });

    it("refuses a recorded refund larger than what is still captured", async () => {
      const order = await orderByReference("TO-4192");
      await expect(
        recordDashboardRefund(ctx, admin, order.id, {
          providerRefundId: "re_testtoobig",
          amount: 99_999_999n,
          reason: "Fat finger.",
        }),
      ).rejects.toThrow(ValidationError);
    });

    it("refuses a refund id that is not one", async () => {
      const order = await orderByReference("TO-4192");
      await expect(
        recordDashboardRefund(ctx, admin, order.id, {
          providerRefundId: "not-a-stripe-id",
          amount: 100n,
          reason: "Typed it from memory.",
        }),
      ).rejects.toThrow(ValidationError);
    });

    it("refuses every action from a customer and from a vendor's staff", async () => {
      const order = await orderByReference("TO-4192");

      await expect(markOrderFulfilled(ctx, customer, order.id)).rejects.toThrow();
      await expect(markOrderFulfilled(ctx, vendorStaff, order.id)).rejects.toThrow();
      await expect(retryBalance(ctx, customer, order.id)).rejects.toThrow();
      await expect(refundCoolingWindow(ctx, vendorStaff, order.id)).rejects.toThrow();
      await expect(
        resolveOrderIssue(ctx, customer, order.id, "confirmed", "Let me."),
      ).rejects.toThrow();
      await expect(
        recordDashboardRefund(ctx, vendorStaff, order.id, {
          providerRefundId: "re_testx",
          amount: 100n,
          reason: "Mine now.",
        }),
      ).rejects.toThrow();

      // And nothing moved.
      expect((await ordering.load(ctx.db, order.id))?.state).toBe("confirmed");
    });
  });
});
