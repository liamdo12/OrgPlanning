import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type postgres from "postgres";
import type { Actor } from "../src/identity/actor.js";
import type { CoreContext } from "../src/context.js";
import {
  AgreementMismatchError,
  CapacityConflictError,
  NotFoundError,
  ValidationError,
} from "../src/errors.js";
import { getActor } from "../src/identity/service.js";
import { quoteCheckout } from "../src/catalog/quote-checkout.js";
import { cancelOrder, createCheckout, type CheckoutRequest } from "../src/ordering/service.js";
import {
  extendCheckoutWindow,
  getOrderForCustomer,
  listOrdersForCustomer,
} from "../src/ordering/customer-service.js";
import { addItemToPlan, eventHub } from "../src/planning/service.js";
import {
  applyWebhook,
  chargeBalance,
  chargeDeposit,
  refundWithinCoolingWindow,
} from "../src/payments/service.js";
import { runDueJobs } from "../src/jobs/runner.js";
import { createStripeFake, type StripeFake } from "../src/testing/stripe-fake.js";
import { createDatabaseContext, ownerSql, resetDatabase, testDatabaseUrl } from "./harness.js";

/**
 * The booking spine, end to end.
 *
 * Everything here needs a real database, because everything here is a claim
 * about rows: a date held by a constraint, a slot that knows which order was
 * placed from it, an agreement recorded beside the figures it consented to, and
 * an expiry that races a customer's own card.
 *
 * The provider is the in-memory fake, which declines, times out and forgets
 * idempotency keys on demand. It is deliberately not a stub that succeeds: the
 * cases worth writing down here are the ones where something goes wrong after
 * the money has moved.
 */

const url = testDatabaseUrl();

describe.skipIf(!url)("the booking spine", () => {
  const dbUrl = url as string;
  let sql: postgres.Sql;
  let database: ReturnType<typeof createDatabaseContext>;
  let ctx: CoreContext;
  let stripe: StripeFake;

  let admin: Actor;
  let sarah: Actor;
  let ada: Actor;
  let sarahId: string;
  let adaId: string;

  /** Bloom & Co's listing, sold under a policy this suite sets explicitly. */
  let serviceId: string;
  let vendorId: string;
  let categoryId: string;

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
    // Approved vendors need a connected account before anything can be paid out.
    await sql`
      update app.planning_org_vendors
      set stripe_account_id = 'acct_test_' || left(id::text, 8),
          stripe_payouts_enabled_at = now()
      where status = 'approved'
    `;

    const [service] = await sql<{ id: string; vendor_id: string; category_id: string }[]>`
      select s.id, s.vendor_id, s.category_id
      from app.planning_org_services s
      join app.planning_org_vendors v on v.id = s.vendor_id
      where v.slug = 'bloom-and-co' and v.status = 'approved'
      limit 1
    `;
    serviceId = service?.id as string;
    vendorId = service?.vendor_id as string;
    categoryId = service?.category_id as string;

    // Sold under `flexible`, whose free-cancellation window is a hundred and
    // sixty-eight hours. Stated rather than assumed: half the cases below turn
    // on whether that window is open, and a seed change would otherwise move
    // them somewhere they were not written for.
    await sellUnder("flexible");

    sarah = await signInAs("sarah@example.ca");
    sarahId = userIdOf(sarah);
    ada = await signInAs("ada.okafor@example.ca");
    adaId = userIdOf(ada);
    admin = await signInAs("admin@occasion.test");

    // Back to the customer almost every case runs as. The adapter reports one
    // signed-in person at a time.
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

  function userIdOf(actor: Actor): string {
    return (actor as Extract<Actor, { kind: "user" }>).userId;
  }

  async function sellUnder(tier: string): Promise<void> {
    await sql`
      update app.planning_org_services
      set policy_template_id = (
        select id from app.planning_org_policy_templates where tier = ${tier}
      )
      where id = ${serviceId}
    `;
  }

  /** An event of someone's, a given number of days out. */
  async function eventIn(days: number, owner: string, name: string): Promise<string> {
    const [row] = await sql<{ id: string }[]>`
      insert into app.planning_org_events (owner_user_id, name, event_date, start_time, timezone)
      values (
        ${owner},
        ${name},
        (now() + (${days} || ' days')::interval)::date,
        '17:00',
        'America/Toronto'
      )
      returning id
    `;
    return row?.id as string;
  }

  function request(eventId: string, quantity = 4): CheckoutRequest {
    return { eventId, lines: [{ serviceId, quantity }] };
  }

  /** What the screen would have displayed, straight off the quote. */
  async function stated(actor: Actor, req: CheckoutRequest) {
    const quote = await quoteCheckout(ctx, actor, req);
    const order = quote.orders[0];
    if (!order) throw new Error("the quote priced nothing");

    return {
      quote: order,
      expectation: {
        total: order.total,
        depositAmount: order.depositAmount,
        balanceAmount: order.balanceAmount,
        balanceDueAt: order.balanceDueAt,
      },
    };
  }

  /** Settles the deposit the way the provider's webhook does. */
  async function settle(orderId: string, deposit: { paymentId: string; intentId: string }) {
    stripe.settlePaymentIntent(deposit.intentId);
    const intent = await stripe.retrievePaymentIntent(deposit.intentId);

    return applyWebhook(ctx, {
      type: "payment_intent.succeeded",
      object: {
        id: deposit.intentId,
        latest_charge: intent?.chargeId,
        metadata: { order_id: orderId, payment_id: deposit.paymentId },
      },
    });
  }

  async function pay(orderId: string) {
    const deposit = await chargeDeposit(ctx, sarah, orderId);
    const handle = { paymentId: deposit.paymentId, intentId: deposit.providerPaymentIntentId };
    await settle(orderId, handle);
    return { ...deposit, ...handle };
  }

  async function stateOf(orderId: string): Promise<string> {
    const [row] = await sql<{ state: string }[]>`
      select state from app.planning_org_orders where id = ${orderId}
    `;
    return row?.state as string;
  }

  async function auditFor(orderId: string, action: string) {
    const [row] = await sql<{ after: Record<string, unknown> }[]>`
      select after from app.planning_org_audit_log
      where entity_id = ${orderId} and action = ${action}
      order by created_at desc, id desc limit 1
    `;
    return row?.after;
  }

  // ---- what a booking costs -------------------------------------------------

  describe("what it costs", () => {
    it("takes the whole total when the event is inside the balance lead time", async () => {
      // The quote and the checkout run the same pricing, so the interesting
      // case is the one where the shape itself changes: inside the lead time
      // there is no later date to charge a balance on, so there is no balance.
      const eventId = await eventIn(5, sarahId, "Next week");

      const quote = await quoteCheckout(ctx, sarah, request(eventId));
      const checkout = await createCheckout(ctx, sarah, request(eventId));

      const quoted = quote.orders[0];
      const bought = checkout.orders[0];

      expect(quoted?.planKind).toBe("full");
      expect(quoted?.planReason).toBe("short_notice");
      expect([quoted?.depositAmount, quoted?.balanceAmount, quoted?.balanceDueAt]).toEqual([
        quoted?.total,
        0n,
        null,
      ]);
      expect([bought?.depositAmount, bought?.balanceAmount, bought?.balanceDueAt]).toEqual([
        bought?.total,
        0n,
        null,
      ]);
      expect(bought?.total).toBe(quoted?.total);
    });

    it("prices the quote and the charge identically on an ordinary booking", async () => {
      const eventId = await eventIn(200, sarahId, "Ordinary booking");

      const { quote } = await stated(sarah, request(eventId));
      const checkout = await createCheckout(ctx, sarah, request(eventId));
      const bought = checkout.orders[0];

      expect([bought?.total, bought?.depositAmount, bought?.balanceAmount]).toEqual([
        quote.total,
        quote.depositAmount,
        quote.balanceAmount,
      ]);
      expect(bought?.balanceDueAt?.getTime()).toBe(quote.balanceDueAt?.getTime());
    });

    it("refuses one business's lines sold under two different policies", async () => {
      const eventId = await eventIn(210, sarahId, "Mixed policies");

      // A second listing of the same business under stricter terms. An order
      // carries one `policy_template_id`, so charging both at one of them takes
      // a deposit on a policy the customer was never shown.
      const [second] = await sql<{ id: string }[]>`
        insert into app.planning_org_services
          (vendor_id, category_id, slug, title, base_price, price_unit, booking_mode,
           policy_template_id, published_at)
        select s.vendor_id, s.category_id, 'journey-strict', 'Strict sibling',
               s.base_price, s.price_unit, s.booking_mode,
               (select id from app.planning_org_policy_templates where tier = 'strict'),
               s.published_at
        from app.planning_org_services s where s.id = ${serviceId}
        returning id
      `;

      await expect(
        createCheckout(ctx, sarah, {
          eventId,
          lines: [
            { serviceId, quantity: 1 },
            { serviceId: second?.id as string, quantity: 1 },
          ],
        }),
      ).rejects.toMatchObject({ issues: { policy: "mixed" } });
    });
  });

  // ---- the agreement --------------------------------------------------------

  describe("the agreement", () => {
    it("records the figures the screen displayed", async () => {
      const eventId = await eventIn(180, sarahId, "Agreed booking");
      const { quote, expectation } = await stated(sarah, request(eventId));

      const checkout = await createCheckout(ctx, sarah, { ...request(eventId), expectation });
      const orderId = checkout.orders[0]?.id as string;

      const [row] = await sql<
        {
          agreed_total: string;
          agreed_deposit_amount: string;
          agreed_balance_amount: string;
          agreed_balance_due_at: Date | null;
          agreed_at: Date | null;
        }[]
      >`
        select agreed_total::text, agreed_deposit_amount::text, agreed_balance_amount::text,
               agreed_balance_due_at, agreed_at
        from app.planning_org_orders where id = ${orderId}
      `;

      expect(row?.agreed_at).not.toBeNull();
      expect([
        BigInt(row?.agreed_total as string),
        BigInt(row?.agreed_deposit_amount as string),
        BigInt(row?.agreed_balance_amount as string),
        row?.agreed_balance_due_at?.getTime(),
      ]).toEqual([
        quote.total,
        quote.depositAmount,
        quote.balanceAmount,
        quote.balanceDueAt?.getTime(),
      ]);
    });

    it("puts the agreed figures on the order's own audit entry", async () => {
      const eventId = await eventIn(181, sarahId, "Audited agreement");
      const { quote, expectation } = await stated(sarah, request(eventId));

      const checkout = await createCheckout(ctx, sarah, { ...request(eventId), expectation });
      const orderId = checkout.orders[0]?.id as string;

      const after = await auditFor(orderId, "order.create");

      expect(after?.["agreedTotal"]).toBe(quote.total.toString());
      expect(after?.["agreedDepositAmount"]).toBe(quote.depositAmount.toString());
      expect(after?.["agreedBalanceAmount"]).toBe(quote.balanceAmount.toString());
    });

    it("aborts when a rate is saved between the quote and the button, writing nothing", async () => {
      const eventId = await eventIn(182, sarahId, "Rate moved");
      const { quote, expectation } = await stated(sarah, request(eventId));

      // What an administrator saving a new tax rate on the settings screen
      // does. The checkout reads it inside its own transaction, deliberately,
      // which is exactly why the figures can move under a screen that has
      // already been read.
      //
      // The rate rather than the commission: commission comes *out of* the
      // total rather than being added to it, so changing it moves what the
      // platform keeps and not one figure the customer was shown.
      await sql`
        update app.planning_org_platform_settings
        set value = '1500'::jsonb where key = 'hst_bps'
      `;

      const refusal = await createCheckout(ctx, sarah, {
        ...request(eventId),
        expectation,
      }).catch((error: unknown) => error);

      expect(refusal).toBeInstanceOf(AgreementMismatchError);
      // The figures that would actually be charged travel on the refusal, so
      // the screen can ask again rather than re-quoting into a third answer.
      expect((refusal as AgreementMismatchError).terms.total).not.toBe(quote.total);

      const [row] = await sql<{ count: string }[]>`
        select count(*)::text from app.planning_org_orders where event_id = ${eventId}
      `;
      expect(row?.count).toBe("0");
    });

    it("ignores the cooling-window end, which moves with the clock", async () => {
      // An expectation that included it would abort every checkout ever made:
      // the window is `now + hours`, and the two `now`s are the screen's and
      // the transaction's.
      const eventId = await eventIn(183, sarahId, "Window moves");
      const { expectation } = await stated(sarah, request(eventId));

      await expect(
        createCheckout(ctx, sarah, { ...request(eventId), expectation }),
      ).resolves.toMatchObject({ orders: [{ vendorId }] });
    });
  });

  // ---- the journey ----------------------------------------------------------

  describe("plan to booked", () => {
    it("runs plan → checkout → deposit → webhook → confirmed, and the slot says so", async () => {
      const eventId = await eventIn(190, sarahId, "Sarah's journey");

      // The real planning path, so the slot under test is the one the planner
      // actually writes rather than a row this test invented.
      await addItemToPlan(ctx, sarah, { eventId, serviceId, quantity: 2 });

      const checkout = await createCheckout(ctx, sarah, request(eventId, 2));
      const orderId = checkout.orders[0]?.id as string;

      const deposit = await chargeDeposit(ctx, sarah, orderId);
      expect(deposit.settled).toBe(false);
      // The state change waits for the webhook. A charge that looked settled
      // here and was reversed a second later would have confirmed a booking
      // nobody paid for.
      expect(await stateOf(orderId)).toBe("pending_payment");

      await settle(orderId, {
        paymentId: deposit.paymentId,
        intentId: deposit.providerPaymentIntentId,
      });

      expect(await stateOf(orderId)).toBe("confirmed");

      const [slot] = await sql<{ order_id: string | null }[]>`
        select order_id from app.planning_org_event_items
        where event_id = ${eventId} and category_id = ${categoryId}
      `;
      expect(slot?.order_id).toBe(orderId);

      const hub = await eventHub(ctx, sarah, eventId);
      const booked = hub.items.find((item) => item.categoryId === categoryId);
      expect(booked?.state).toEqual({ kind: "booked" });
      expect(booked?.orderId).toBe(orderId);
    });

    it("keeps the card the deposit was taken on, and charges the balance to it", async () => {
      const eventId = await eventIn(191, sarahId, "Card on file");
      const checkout = await createCheckout(ctx, sarah, request(eventId));
      const orderId = checkout.orders[0]?.id as string;

      await pay(orderId);

      const [card] = await sql<{ card_last4: string | null }[]>`
        select card_last4 from app.planning_org_payments
        where order_id = ${orderId} and state = 'succeeded'
      `;
      expect(card?.card_last4).toBe("4242");

      // The planner's payments panel reads it from the same place, so the line
      // it draws is a column rather than a live provider call per order.
      const hub = await eventHub(ctx, sarah, eventId);
      expect(hub.payments.nextChargeCard).toBe("4242");

      // And the card is usable without the customer present, which is the whole
      // reason the deposit's intent is created with `setup_future_usage`. If
      // that flag were ever dropped this would hand off to an emailed link
      // instead — months later, on the balance date.
      const balance = await chargeBalance(ctx, admin, orderId);
      expect(balance.outcome).toBe("captured");

      const [offSession] = await sql<{ off_session_at: Date | null }[]>`
        select off_session_at from app.planning_org_payments
        where order_id = ${orderId} and kind = 'balance'
      `;
      expect(offSession?.off_session_at).not.toBeNull();
    });

    it("does not open a second charge when Pay is pressed twice", async () => {
      const eventId = await eventIn(192, sarahId, "Double submit");
      const checkout = await createCheckout(ctx, sarah, request(eventId));
      const orderId = checkout.orders[0]?.id as string;

      const first = await chargeDeposit(ctx, sarah, orderId);
      const second = await chargeDeposit(ctx, sarah, orderId);

      expect(second.providerPaymentIntentId).toBe(first.providerPaymentIntentId);
      expect(second.clientSecret).toBe(first.clientSecret);

      const [row] = await sql<{ count: string }[]>`
        select count(*)::text from app.planning_org_payments where order_id = ${orderId}
      `;
      expect(row?.count).toBe("1");
      expect(stripe.created.filter((object) => object.kind === "payment_intent")).toHaveLength(1);
    });
  });

  // ---- coming back ----------------------------------------------------------

  describe("coming back to an unfinished checkout", () => {
    it("resumes the customer's own order rather than colliding with it", async () => {
      const eventId = await eventIn(193, sarahId, "Resumed");

      const first = await createCheckout(ctx, sarah, request(eventId));
      const firstSecret = await chargeDeposit(ctx, sarah, first.orders[0]?.id as string);

      const second = await createCheckout(ctx, sarah, request(eventId));
      const secondSecret = await chargeDeposit(ctx, sarah, second.orders[0]?.id as string);

      expect(second.orders[0]?.id).toBe(first.orders[0]?.id);
      expect(secondSecret.clientSecret).toBe(firstSecret.clientSecret);

      const [row] = await sql<{ count: string }[]>`
        select count(*)::text from app.planning_org_orders where event_id = ${eventId}
      `;
      expect(row?.count).toBe("1");
    });

    it("still refuses a date another customer is holding, and names the day", async () => {
      const mine = await eventIn(194, sarahId, "Mine");
      await createCheckout(ctx, sarah, request(mine));

      // Ada's own event, the same day, the same florist. The constraint does
      // not know whose order holds a date — which is why resuming had to be
      // matched on the customer as well as on the cart.
      const [hers] = await sql<{ id: string; day: string }[]>`
        insert into app.planning_org_events (owner_user_id, name, event_date, start_time, timezone)
        select ${adaId}, 'Hers', event_date, start_time, timezone
        from app.planning_org_events where id = ${mine}
        returning id, event_date::text as day
      `;

      await signInAs("ada.okafor@example.ca");

      const refusal = await createCheckout(ctx, ada, request(hers?.id as string)).catch(
        (error: unknown) => error,
      );

      expect(refusal).toBeInstanceOf(CapacityConflictError);
      expect((refusal as CapacityConflictError).day).toBe(hers?.day);
      expect((refusal as CapacityConflictError).serviceId).toBe(serviceId);
    });

    it("pushes the unpaid expiry out when a client secret is handed over", async () => {
      const eventId = await eventIn(195, sarahId, "Re-armed");
      const checkout = await createCheckout(ctx, sarah, request(eventId));
      const orderId = checkout.orders[0]?.id as string;

      // Pulled back, so the re-arm has somewhere to move it to. `greatest`
      // means a re-arm can only ever push a deadline later, so a job already
      // sitting at thirty minutes would not move at all and the case would
      // assert nothing.
      const [before] = await sql<{ id: string; run_after: Date }[]>`
        update app.planning_org_jobs
        set run_after = now() + interval '5 minutes'
        where dedupe_key = ${`expire_unpaid:${orderId}`}
        returning id, run_after
      `;

      await extendCheckoutWindow(ctx, sarah, orderId);

      const [after] = await sql<{ id: string; run_after: Date }[]>`
        select id, run_after from app.planning_org_jobs
        where dedupe_key = ${`expire_unpaid:${orderId}`}
      `;

      // The same row, later. A cancel-then-enqueue would have destroyed it —
      // `done` is the one status `enqueue` never re-arms — and the date it was
      // going to release would never be released.
      expect(after?.id).toBe(before?.id);
      expect((after?.run_after as Date).getTime()).toBeGreaterThan(
        (before?.run_after as Date).getTime(),
      );
    });
  });

  // ---- the expiry that races the card ---------------------------------------

  describe("a charge that lands after the expiry", () => {
    it("is refunded, and the webhook does not fail for three days", async () => {
      const eventId = await eventIn(196, sarahId, "Expired mid-payment");
      const checkout = await createCheckout(ctx, sarah, request(eventId));
      const orderId = checkout.orders[0]?.id as string;

      const deposit = await chargeDeposit(ctx, sarah, orderId);

      // The customer is interrupted — slow 3DS, a lost connection — and the
      // thirty minutes run out while their card is still in flight.
      await sql`
        update app.planning_org_jobs set run_after = now() - interval '1 minute'
        where dedupe_key = ${`expire_unpaid:${orderId}`}
      `;
      await runDueJobs(ctx, { asOf: new Date(), demoOnly: false, trigger: "cron" });

      expect(await stateOf(orderId)).toBe("cancelled");

      // And then the capture arrives.
      await expect(
        settle(orderId, {
          paymentId: deposit.paymentId,
          intentId: deposit.providerPaymentIntentId,
        }),
      ).resolves.toBeDefined();

      const [refund] = await sql<{ state: string; amount: string }[]>`
        select state, amount::text from app.planning_org_refunds where order_id = ${orderId}
      `;
      expect(refund?.state).toBe("settled");

      // The date went back on the vendor's calendar when the order was
      // cancelled, and the refund did not take it off again.
      const [held] = await sql<{ count: string }[]>`
        select count(*)::text from app.planning_org_capacity_blocks
        where order_id = ${orderId} and active = true
      `;
      expect(held?.count).toBe("0");
    });
  });

  // ---- the customer's own view ----------------------------------------------

  describe("a customer's own bookings", () => {
    it("lists theirs and nobody else's, counted off the table", async () => {
      const mine = await eventIn(197, sarahId, "Sarah lists");
      await createCheckout(ctx, sarah, request(mine));

      const [expected] = await sql<{ count: string }[]>`
        select count(*)::text from app.planning_org_orders where user_id = ${sarahId}
      `;
      const [theirs] = await sql<{ id: string }[]>`
        select id from app.planning_org_orders where user_id <> ${sarahId} limit 1
      `;

      const listed = await listOrdersForCustomer(ctx, sarah, { limit: 200 });

      // Read off the table rather than hardcoded: "returns 5 rows" passes for a
      // list that returns everything.
      expect(listed).toHaveLength(Number(expected?.count));
      expect(listed.map((order) => order.id)).not.toContain(theirs?.id);
    });

    it("answers 'no such order' for somebody else's booking", async () => {
      const [theirs] = await sql<{ id: string }[]>`
        select id from app.planning_org_orders where user_id <> ${sarahId} limit 1
      `;

      // Not "forbidden": a different answer for "not yours" and "no such row"
      // turns an id in a URL into a way to find out which bookings exist.
      await expect(getOrderForCustomer(ctx, sarah, theirs?.id as string)).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });

    it("reads back what was bought, what was paid and what was agreed", async () => {
      const eventId = await eventIn(198, sarahId, "Read back");
      const { quote, expectation } = await stated(sarah, request(eventId));
      const checkout = await createCheckout(ctx, sarah, { ...request(eventId), expectation });
      const orderId = checkout.orders[0]?.id as string;

      await pay(orderId);

      const detail = await getOrderForCustomer(ctx, sarah, orderId);

      expect(detail.items).toHaveLength(1);
      expect(detail.money.captured).toBe(quote.depositAmount);
      expect(detail.money.payments[0]?.cardLast4).toBe("4242");
      expect(detail.order.agreement?.total).toBe(quote.total);
      expect(detail.order.policyName).toBe("Flexible");
      expect(detail.freeCancellation.open).toBe(true);
    });
  });

  // ---- cancelling -----------------------------------------------------------

  describe("cancelling", () => {
    it("refunds inside the window and puts the date back on the market", async () => {
      const eventId = await eventIn(199, sarahId, "Cancelled in time");
      const checkout = await createCheckout(ctx, sarah, request(eventId));
      const orderId = checkout.orders[0]?.id as string;

      await pay(orderId);
      const refund = await refundWithinCoolingWindow(ctx, sarah, orderId);

      expect(refund.state).toBe("settled");
      expect(refund.amount).toBe(checkout.orders[0]?.depositAmount);
      expect(await stateOf(orderId)).toBe("refunded");

      // The date is free again, which is the claim that matters to the vendor:
      // asserted by booking it rather than by reading a flag.
      const ada = await signInAs("ada.okafor@example.ca");
      const [hers] = await sql<{ id: string }[]>`
        insert into app.planning_org_events (owner_user_id, name, event_date, start_time, timezone)
        select ${adaId}, 'Same day, free again', event_date, start_time, timezone
        from app.planning_org_events where id = ${eventId}
        returning id
      `;

      await expect(createCheckout(ctx, ada, request(hers?.id as string))).resolves.toMatchObject({
        orders: [{ vendorId }],
      });
    });

    it("refuses once the free window has closed, and says so", async () => {
      const eventId = await eventIn(201, sarahId, "Too late");
      const checkout = await createCheckout(ctx, sarah, request(eventId));
      const orderId = checkout.orders[0]?.id as string;

      await pay(orderId);
      await sql`
        update app.planning_org_orders set cooling_window_ends_at = now() - interval '1 hour'
        where id = ${orderId}
      `;

      const refusal = await refundWithinCoolingWindow(ctx, sarah, orderId).catch(
        (error: unknown) => error,
      );

      expect(refusal).toBeInstanceOf(ValidationError);
      expect((refusal as ValidationError).issues["window"]).toBe("closed");
      // And the screen can tell beforehand, so it offers a sentence rather than
      // a button that comes back refused.
      const detail = await getOrderForCustomer(ctx, sarah, orderId);
      expect(detail.freeCancellation.open).toBe(false);
    });

    it("records a cancellation the customer's own policy still covered", async () => {
      // `flexible` gives a hundred and sixty-eight hours of free cancellation;
      // a declined balance gives seventy-two hours of grace. An event a
      // fortnight out therefore has the platform cancelling for non-payment
      // while the customer's policy still promised their money back. Nothing
      // here refunds automatically: what is owed depends on why the card failed
      // and whether the booking is still wanted.
      const eventId = await eventIn(202, sarahId, "Grace inside the window");
      const checkout = await createCheckout(ctx, sarah, request(eventId));
      const orderId = checkout.orders[0]?.id as string;

      await pay(orderId);
      await cancelOrder(ctx, admin, orderId, "order.grace_expired");

      const after = await auditFor(orderId, "order.grace_expired");

      expect(after?.["refundReview"]).toBe("free_window_open");
      expect(after?.["freeWindowEndsAt"]).toEqual(expect.any(String));
      // The amount, because it is the thing somebody reading this has to act on.
      expect(after?.["capturedAmount"]).toBe(checkout.orders[0]?.depositAmount.toString());
    });

    it("raises no review for an unpaid checkout that simply expired", async () => {
      // Every one of these expires inside its own cooling window, so a check on
      // the window alone would ask a person about money nobody ever paid.
      const eventId = await eventIn(203, sarahId, "Nothing paid");
      const checkout = await createCheckout(ctx, sarah, request(eventId));
      const orderId = checkout.orders[0]?.id as string;

      await cancelOrder(ctx, admin, orderId, "order.expire_unpaid");

      const after = await auditFor(orderId, "order.expire_unpaid");
      expect(after?.["refundReview"]).toBeUndefined();
    });
  });
});
