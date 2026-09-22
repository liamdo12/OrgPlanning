import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type postgres from "postgres";
import type { Actor } from "../src/identity/actor.js";
import type { CoreContext } from "../src/context.js";
import { NotFoundError, ValidationError } from "../src/errors.js";
import { getActor } from "../src/identity/service.js";
import {
  autoComplete,
  cancelOrder,
  createCheckout,
  getOrder,
  markFulfilled,
  raiseIssue,
} from "../src/ordering/service.js";
import * as ordering from "../src/ordering/repo.js";
import { runDueJobs } from "../src/jobs/runner.js";
import {
  UnknownOrderError,
  applyWebhook,
  chargeBalance,
  chargeDeposit,
  openPaymentLink,
  startLinkCheckout,
  recordExternalRefund,
  refundWithinCoolingWindow,
  transferShare,
} from "../src/payments/service.js";
import * as payments from "../src/payments/repo.js";
import { paymentLinkDigest } from "../src/payments/payment-links.js";
import { getVendorDetail } from "../src/vendors/service.js";
import { RETRY_CEILING_MS } from "../src/payments/stripe.js";
import type { StripeFake } from "../src/testing/stripe-fake.js";
import { createStripeFake } from "../src/testing/stripe-fake.js";
import { createDatabaseContext, ownerSql, resetDatabase, testDatabaseUrl } from "./harness.js";

/**
 * The money spine, against a real database and a provider that misbehaves.
 *
 * The claims worth making here are the ones neither a unit test nor a happy
 * path can make: that a date is released when a booking ends, that a replayed
 * webhook changes nothing the second time, that an event which arrives before
 * its order is kept rather than dropped, that a suspended vendor's payout
 * stops, and that a retry beyond the provider's idempotency window does not
 * charge somebody twice.
 */

const url = testDatabaseUrl();

describe.skipIf(!url)("orders and payments", () => {
  const dbUrl = url as string;
  let sql: postgres.Sql;
  let database: ReturnType<typeof createDatabaseContext>;
  let ctx: CoreContext;
  let stripe: StripeFake;
  let admin: Actor;
  let customer: Actor;

  /** Seeded rows this suite books against, and one event it makes for itself. */
  let sarahId: string;
  let eventId: string;
  let bloomServiceId: string;
  let bloomVendorId: string;

  /**
   * How far off the event this suite books against sits.
   *
   * Comfortably past the balance lead time, so `book()` produces the
   * deposit-and-balance shape most of the lifecycle is about, and clear of
   * every offset `bookForEventIn` uses so those bookings never collide with
   * this one.
   */
  const EVENT_DAYS_AWAY = 150;

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

    // Bind provider subjects the way a first sign-in would, so both actors can
    // be built from the same database.
    await sql`
      update app.planning_org_users
      set auth_provider_sub = 'provider-sub-' || email
    `;

    const [sarah] = await sql<{ id: string }[]>`
      select id from app.planning_org_users where email = 'sarah@example.ca'
    `;
    sarahId = sarah?.id as string;

    // An event of Sarah's on a date nothing has booked, rather than one of the
    // seeded ones. Every seeded booking now holds its date in `capacity_blocks`,
    // which is the point of seeding them — so a suite that booked Bloom & Co on
    // Sarah's 30th would be booking the date TO-4192 is already holding, and
    // every case below would fail on the exclusion constraint rather than on
    // whatever it is about.
    const [event] = await sql<{ id: string }[]>`
      insert into app.planning_org_events (owner_user_id, name, event_date, start_time, timezone)
      values (
        ${sarahId},
        'Payments fixture',
        (now() + (${EVENT_DAYS_AWAY} || ' days')::interval)::date,
        '17:00',
        'America/Toronto'
      )
      returning id
    `;
    eventId = event?.id as string;

    const [service] = await sql<{ id: string; vendor_id: string }[]>`
      select s.id, s.vendor_id
      from app.planning_org_services s
      join app.planning_org_vendors v on v.id = s.vendor_id
      where v.slug = 'bloom-and-co' and v.status = 'approved'
      limit 1
    `;
    bloomServiceId = service?.id as string;
    bloomVendorId = service?.vendor_id as string;

    // Approved vendors need a connected account before anything can be paid out.
    await sql`
      update app.planning_org_vendors
      set stripe_account_id = 'acct_test_' || left(id::text, 8),
          stripe_payouts_enabled_at = now()
      where status = 'approved'
    `;

    signInAs("admin@occasion.test");
    admin = await getActor(ctx, {});

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

  /**
   * A fresh booking.
   *
   * Four of a C$95.00 service: C$380.00 plus HST is comfortably over the
   * C$250 threshold below which the whole total is taken at checkout, so this
   * is the deposit-and-balance shape the lifecycle is mostly about.
   */
  async function book(quantity = 4) {
    signInAs("sarah@example.ca");
    const result = await createCheckout(ctx, customer, {
      eventId,
      lines: [{ serviceId: bloomServiceId, quantity }],
    });
    return result.orders[0] as NonNullable<(typeof result.orders)[number]>;
  }

  /**
   * A booking whose event is a given number of days away.
   *
   * The seeded events sit where the demo needs them; the payment plan turns on
   * how far off the event is, so the cases that matter need their own. A fresh
   * event also means a fresh date, which the capacity constraint requires.
   */
  async function bookForEventIn(days: number, quantity = 4) {
    const [created] = await sql<{ id: string }[]>`
      insert into app.planning_org_events (owner_user_id, name, event_date, start_time, timezone)
      values (
        ${sarahId},
        ${`Event in ${days} days`},
        (now() + (${days} || ' days')::interval)::date,
        '17:00',
        'America/Toronto'
      )
      returning id
    `;

    signInAs("sarah@example.ca");
    const result = await createCheckout(ctx, customer, {
      eventId: created?.id as string,
      lines: [{ serviceId: bloomServiceId, quantity }],
    });
    return result.orders[0] as NonNullable<(typeof result.orders)[number]>;
  }

  /** Sells the service under a named policy, the way its listing would. */
  async function sellUnder(tier: string | null): Promise<string | null> {
    const [row] = await sql<{ id: string }[]>`
      update app.planning_org_services
      set policy_template_id = (
        select id from app.planning_org_policy_templates where tier = ${tier}
      )
      where id = ${bloomServiceId}
      returning policy_template_id as id
    `;
    return row?.id ?? null;
  }

  const LINK_URLS = {
    successUrl: "https://occasion.test/pay/done",
    cancelUrl: "https://occasion.test/pay/cancelled",
  };

  /** Finishes a hosted checkout the way the customer does, then delivers the event. */
  async function settleLinkCheckout(orderId: string, paymentId: string) {
    const attempt = await payments.loadPayment(ctx.db, paymentId);
    const intentId = attempt?.providerPaymentIntentId as string;

    stripe.settleCheckoutSession(intentId);
    const intent = await stripe.retrievePaymentIntent(intentId);

    await applyWebhook(ctx, {
      type: "checkout.session.completed",
      object: {
        id: "cs_test",
        payment_intent: intentId,
        metadata: { order_id: orderId, payment_id: paymentId },
      },
    });
    return intent;
  }

  /**
   * Takes the deposit and settles it the way the provider does.
   *
   * The intent is *not* settled by creating it — production Stripe returns
   * `requires_confirmation` for an intent nobody has confirmed, and the fake
   * says the same. Only the webhook confirms an order, which is the whole
   * reason the deposit path waits for one.
   */
  async function payDeposit(orderId: string) {
    const deposit = await chargeDeposit(ctx, customer, orderId);
    expect(deposit.settled).toBe(false);

    stripe.settleCheckoutSession(deposit.providerPaymentIntentId);
    const intent = await stripe.retrievePaymentIntent(deposit.providerPaymentIntentId);

    await applyWebhook(ctx, {
      type: "payment_intent.succeeded",
      object: {
        id: deposit.providerPaymentIntentId,
        latest_charge: intent?.chargeId,
        metadata: { order_id: orderId, payment_id: deposit.paymentId },
      },
    });
    return deposit;
  }

  describe("checkout", () => {
    it("prices from the catalogue and holds the date before taking money", async () => {
      const order = await book(4);

      const [row] = await sql<{ subtotal: string; total: string; state: string }[]>`
        select subtotal::text, total::text, state from app.planning_org_orders where id = ${order.id}
      `;
      expect(row?.state).toBe("pending_payment");

      const [service] = await sql<{ base_price: string }[]>`
        select base_price::text from app.planning_org_services where id = ${bloomServiceId}
      `;
      // The amount comes from the catalogue, not from the request.
      expect(BigInt(row?.subtotal as string)).toBe(BigInt(service?.base_price as string) * 4n);

      const blocks = await ordering.listCapacityBlocks(ctx.db, order.id);
      expect(blocks).toHaveLength(1);
      expect(blocks[0]?.active).toBe(true);
    });

    it("queues the soft hold's own expiry, so an abandoned cart frees its date", async () => {
      const order = await book();
      const jobs = await ordering.listJobsForOrder(ctx.db, order.id);
      expect(jobs.map((job) => job.type)).toEqual(["expire_unpaid"]);
    });

    it("refuses a service whose vendor is not approved, the same way as one that does not exist", async () => {
      await sql`update app.planning_org_vendors set status = 'suspended' where id = ${bloomVendorId}`;

      await expect(book()).rejects.toBeInstanceOf(NotFoundError);
      await expect(
        createCheckout(ctx, customer, {
          eventId,
          lines: [{ serviceId: "00000000-0000-0000-0000-000000000000", quantity: 1 }],
        }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("refuses a booking against somebody else's event", async () => {
      // Ada's event, Sarah's request. The answer is the same `NotFoundError` an
      // unknown id gets, so this is not a way to discover which events exist.
      const [adas] = await sql<{ id: string }[]>`
        select e.id from app.planning_org_events e
        join app.planning_org_users u on u.id = e.owner_user_id
        where u.email = 'ada.okafor@example.ca' limit 1
      `;

      await expect(
        createCheckout(ctx, customer, {
          eventId: adas?.id as string,
          lines: [{ serviceId: bloomServiceId, quantity: 4 }],
        }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("takes the deposit and the free window from the policy the service is sold under", async () => {
      const templates = await sql<
        { id: string; tier: string; deposit_bps: number; free_hours: number }[]
      >`
        select id, tier, deposit_bps, free_cancellation_hours as free_hours
        from app.planning_org_policy_templates order by deposit_bps
      `;
      expect(templates.map((row) => row.deposit_bps)).toEqual([1000, 2000, 3000]);
      // Three genuinely different free windows, so the assertion below is not
      // three readings of one number.
      expect(templates.map((row) => row.free_hours)).toEqual([168, 48, 0]);

      for (const [index, template] of templates.entries()) {
        // The listing decides, not the request. Nothing the customer sends
        // names a template, so there is nothing to name a cheaper one with.
        await sellUnder(template.tier);
        const order = await bookForEventIn(200 + index * 10);

        const [row] = await sql<
          {
            deposit_amount: string;
            total: string;
            policy_template_id: string;
            free_hours: number;
          }[]
        >`
          select deposit_amount::text, total::text, policy_template_id,
                 round(extract(epoch from (cooling_window_ends_at - created_at)) / 3600)::int
                   as free_hours
          from app.planning_org_orders where id = ${order.id}
        `;

        const total = BigInt(row?.total as string);
        // Half away from zero, the same rounding the domain uses.
        const expected = (total * BigInt(template.deposit_bps) + 5000n) / 10000n;

        expect([template.tier, BigInt(row?.deposit_amount as string)]).toEqual([
          template.tier,
          expected,
        ]);
        // The free-cancellation window is the other half of the policy, and it
        // comes from the same row as the deposit.
        expect([template.tier, row?.free_hours]).toEqual([template.tier, template.free_hours]);
        // And the order records the terms it was actually priced under, so its
        // own record cannot disagree with the deposit it took.
        expect([template.tier, row?.policy_template_id]).toEqual([template.tier, template.id]);
      }

      // `strict` allows no free cancellation at all, so its window closes the
      // moment the booking is made — a 30% deposit that is refundable for two
      // days is not the strict policy.
      await sellUnder("strict");
      const order = await bookForEventIn(300);
      await expect(refundWithinCoolingWindow(ctx, customer, order.id)).rejects.toBeInstanceOf(
        ValidationError,
      );
    });

    it("prices a service with no policy at the platform's own deposit rate", async () => {
      // Null is an ordinary answer, and `platform_settings.deposit_bps` is what
      // it falls back to — a catalogue row nobody has chosen terms for still
      // has to be bookable at a rate somebody vetted.
      expect(await sellUnder(null)).toBeNull();

      const order = await bookForEventIn(210);
      const [row] = await sql<
        { deposit_amount: string; total: string; policy_template_id: string | null }[]
      >`
        select deposit_amount::text, total::text, policy_template_id
        from app.planning_org_orders where id = ${order.id}
      `;
      const [setting] = await sql<{ value: number }[]>`
        select value::int as value from app.planning_org_platform_settings
        where key = 'deposit_bps'
      `;

      const total = BigInt(row?.total as string);
      expect(BigInt(row?.deposit_amount as string)).toBe(
        (total * BigInt(setting?.value as number) + 5000n) / 10000n,
      );
      // No template, so the order names none rather than inventing one.
      expect(row?.policy_template_id).toBeNull();
    });

    it("refuses one order whose lines are sold under different policies", async () => {
      // An order carries a single `policy_template_id`. Two services under one
      // business with different terms would have to be charged at one of them,
      // and the customer was shown both.
      // Published, like the listing it is copied from: a draft is not bookable
      // at all, so an unpublished fixture would be refused for the wrong reason
      // and this case would stop being about mixed terms.
      const [second] = await sql<{ id: string }[]>`
        insert into app.planning_org_services
          (vendor_id, category_id, slug, title, base_price, price_unit, booking_mode,
           policy_template_id, published_at)
        select
          s.vendor_id, s.category_id, 'mixed-policy-fixture', 'Mixed policy fixture',
          s.base_price, s.price_unit, s.booking_mode,
          (select id from app.planning_org_policy_templates where tier = 'strict'),
          s.published_at
        from app.planning_org_services s where s.id = ${bloomServiceId}
        returning id
      `;
      await sellUnder("flexible");

      const [created] = await sql<{ id: string }[]>`
        insert into app.planning_org_events (owner_user_id, name, event_date, start_time, timezone)
        values (${sarahId}, 'Mixed policy event', (now() + interval '250 days')::date,
                '17:00', 'America/Toronto')
        returning id
      `;

      signInAs("sarah@example.ca");
      await expect(
        createCheckout(ctx, customer, {
          eventId: created?.id as string,
          lines: [
            { serviceId: bloomServiceId, quantity: 1 },
            { serviceId: second?.id as string, quantity: 1 },
          ],
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("gives concurrent bookings different references", async () => {
      // `max(reference) + 1` gave both the same number, and `reference` is
      // unique — so two ordinary customers booking at the same moment meant one
      // of them got a 500.
      const [a, b, c] = await Promise.all([
        bookForEventIn(400),
        bookForEventIn(401),
        bookForEventIn(402),
      ]);

      const references = [a.reference, b.reference, c.reference];
      expect(new Set(references).size).toBe(3);
      expect(references.every((reference) => /^TO-\d+$/.test(reference))).toBe(true);
    });

    it("refuses a second booking of the same service on the same day", async () => {
      await book();
      // The exclusion constraint, not an application check: two requests that
      // both passed a "is it free?" test still cannot both commit.
      await expect(book()).rejects.toThrow();
    });
  });

  describe("the deposit", () => {
    it("runs deposit → confirmed and schedules the two jobs a booking needs", async () => {
      const order = await book();
      await payDeposit(order.id);

      const after = await ordering.load(ctx.db, order.id);
      expect(after?.state).toBe("confirmed");

      const jobs = await ordering.listJobsForOrder(ctx.db, order.id);
      const queued = jobs
        .filter((job) => job.status === "queued")
        .map((job) => job.type)
        .sort();
      expect(queued).toEqual(["charge_balance", "cooling_window_transfer"]);
    });

    it("writes the attempt row before calling the provider", async () => {
      const order = await book();
      // A provider that fails after recording its object: the row has to
      // survive, because its id is the key the retry reuses.
      stripe.failNextWith("createPaymentIntent", new Error("network timeout"));

      await expect(chargeDeposit(ctx, customer, order.id)).rejects.toThrow("network timeout");

      const attempts = await payments.listPayments(ctx.db, order.id);
      expect(attempts).toHaveLength(1);
      expect(attempts[0]?.state).toBe("pending");
    });
  });

  describe("a booking paid in full at checkout", () => {
    it("takes the whole total and schedules no balance charge", async () => {
      // Ten days out: inside the fourteen-day lead time, so there is no later
      // charge to make.
      const order = await bookForEventIn(10);

      expect(order.balanceAmount).toBe(0n);
      expect(order.depositAmount).toBe(order.total);
      expect(order.balanceDueAt).toBeNull();

      await payDeposit(order.id);

      const queued = (await ordering.listJobsForOrder(ctx.db, order.id))
        .filter((job) => job.status === "queued")
        .map((job) => job.type);

      // `charge_balance` would be due at event−14 days, which for this booking
      // is already in the past: immediately due, and failing every time the
      // runner picked it up, for ever.
      expect(queued).toEqual(["cooling_window_transfer"]);
    });

    it("runs the whole lifecycle and pays the vendor once", async () => {
      const order = await bookForEventIn(11);
      await payDeposit(order.id);

      // There is no balance to charge, and asking for one is an error rather
      // than a silent no-op.
      await expect(chargeBalance(ctx, admin, order.id)).rejects.toBeInstanceOf(ValidationError);

      await transferShare(ctx, admin, order.id, "deposit_share");
      await markFulfilled(ctx, admin, order.id);
      await autoComplete(ctx, admin, order.id);

      const moved = await payments.listTransfers(ctx.db, order.id);
      const paidOut = moved.reduce((sum, transfer) => sum + transfer.amount, 0n);
      const captured = await payments.netCaptured(ctx.db, order.id);
      const row = await ordering.load(ctx.db, order.id);

      // One transfer carrying the whole share, and the books still balance.
      expect(moved).toHaveLength(1);
      expect(paidOut + (row?.commission as bigint) + (row?.commissionTax as bigint)).toBe(captured);
      expect(captured).toBe(order.total);
    });
  });

  describe("webhooks", () => {
    it("changes state once however many times an event is replayed", async () => {
      const order = await book();
      const deposit = await chargeDeposit(ctx, customer, order.id);
      const intent = await stripe.retrievePaymentIntent(deposit.providerPaymentIntentId);

      const event = {
        type: "payment_intent.succeeded",
        object: { id: deposit.providerPaymentIntentId, latest_charge: intent?.chargeId },
      };

      const first = await applyWebhook(ctx, event);
      const second = await applyWebhook(ctx, event);
      const third = await applyWebhook(ctx, event);

      expect(first.applied).toBe(true);
      expect(second.applied).toBe(false);
      expect(third.applied).toBe(false);

      const [count] = await sql<{ n: string }[]>`
        select count(*)::text as n from app.planning_org_audit_log
        where entity_id = ${order.id} and action = 'payment.deposit_captured'
      `;
      expect(count?.n).toBe("1");
    });

    it("keeps an event that arrives before its order, and applies it once the order exists", async () => {
      // Nothing has created this intent here. The handler must say so in a way
      // the route can park, rather than throwing something indistinguishable
      // from a real failure — or worse, answering 200 and losing it.
      await expect(
        applyWebhook(ctx, {
          type: "payment_intent.succeeded",
          object: { id: "pi_from_the_future", latest_charge: "ch_x" },
        }),
      ).rejects.toBeInstanceOf(UnknownOrderError);

      // Stored unprocessed, which is what the sweep later picks up.
      const parked = await payments.recordWebhook(ctx.db, {
        eventId: "evt_early",
        type: "payment_intent.succeeded",
        account: null,
        payload: {},
        now: new Date(),
      });
      expect(parked.processedAt).toBeNull();

      const unprocessed = await payments.listUnprocessedWebhooks(ctx.db);
      expect(unprocessed.map((row) => row.eventId)).toContain("evt_early");

      // And when the order it was about does exist, the same event applies
      // normally. This is the half that matters: parked is not dropped.
      const order = await book();
      const deposit = await chargeDeposit(ctx, customer, order.id);
      const intent = await stripe.retrievePaymentIntent(deposit.providerPaymentIntentId);

      const replayed = await applyWebhook(ctx, {
        type: "payment_intent.succeeded",
        object: { id: deposit.providerPaymentIntentId, latest_charge: intent?.chargeId },
      });

      expect(replayed.applied).toBe(true);
      expect((await ordering.load(ctx.db, order.id))?.state).toBe("confirmed");
    });

    it("treats a stored-but-unprocessed event as still to do", async () => {
      const now = new Date();
      const first = await payments.recordWebhook(ctx.db, {
        eventId: "evt_1",
        type: "payment_intent.succeeded",
        account: null,
        payload: {},
        now,
      });
      expect(first.alreadySeen).toBe(false);

      // The handler died here. The row exists and nothing was applied.
      const second = await payments.recordWebhook(ctx.db, {
        eventId: "evt_1",
        type: "payment_intent.succeeded",
        account: null,
        payload: {},
        now,
      });
      expect(second.alreadySeen).toBe(true);
      // Idempotency is `processed_at`, never the row existing.
      expect(second.processedAt).toBeNull();

      await payments.markWebhookProcessed(ctx.db, first.id, now);
      const third = await payments.recordWebhook(ctx.db, {
        eventId: "evt_1",
        type: "payment_intent.succeeded",
        account: null,
        payload: {},
        now,
      });
      expect(third.processedAt).not.toBeNull();
    });

    it("treats two simultaneous deliveries of one event as one application", async () => {
      const order = await book();
      const deposit = await chargeDeposit(ctx, customer, order.id);
      stripe.settleCheckoutSession(deposit.providerPaymentIntentId);
      const intent = await stripe.retrievePaymentIntent(deposit.providerPaymentIntentId);

      const event = {
        type: "payment_intent.succeeded",
        object: {
          id: deposit.providerPaymentIntentId,
          latest_charge: intent?.chargeId,
          metadata: { order_id: order.id, payment_id: deposit.paymentId },
        },
      };

      // Both read the order before either moved it. The loser used to throw the
      // lifecycle's "already confirmed" — which the route turns into a 500, and
      // the provider into days of retries for an event that was applied.
      const [first, second] = await Promise.all([
        applyWebhook(ctx, event),
        applyWebhook(ctx, event),
      ]);

      expect([first?.applied, second?.applied].filter(Boolean)).toHaveLength(1);
      expect((await ordering.load(ctx.db, order.id))?.state).toBe("confirmed");
    });

    it("ignores an event type it has no opinion about", async () => {
      const result = await applyWebhook(ctx, { type: "invoice.finalized", object: { id: "in_1" } });
      expect(result.applied).toBe(false);
    });
  });

  describe("the balance", () => {
    it("charges it off-session and returns the order to confirmed", async () => {
      const order = await book();
      await payDeposit(order.id);

      const result = await chargeBalance(ctx, admin, order.id);

      expect(result.outcome).toBe("captured");
      const after = await ordering.load(ctx.db, order.id);
      expect(after?.state).toBe("confirmed");

      const balance = await payments.succeededPaymentOfKind(ctx.db, order.id, "balance");
      expect(balance?.amount).toBe(order.balanceAmount);
    });

    it("hands a declined balance to a single-use link, and starts the grace window", async () => {
      const order = await book();
      await payDeposit(order.id);

      stripe.declineNextCharge();
      const result = await chargeBalance(ctx, admin, order.id);

      expect(result.outcome).toBe("action_required");
      expect(result.link?.token).toBeTruthy();

      const after = await ordering.load(ctx.db, order.id);
      expect(after?.state).toBe("action_required");
      // The link expires exactly when the job that expires the grace window
      // fires — one instant, not two readings of the clock.
      expect(after?.graceExpiresAt).toEqual(result.link?.expiresAt);

      const jobs = await ordering.listJobsForOrder(ctx.db, order.id);
      expect(jobs.map((job) => job.type)).toContain("balance_grace_expiry");
    });

    it("emails that link and that deadline, and keeps neither beside the send", async () => {
      const order = await book();
      await payDeposit(order.id);

      stripe.declineNextCharge();
      const result = await chargeBalance(ctx, admin, order.id);
      const token = result.link?.token as string;

      const [send] = await sql<{ subject: string; merge_values: Record<string, string> }[]>`
        select subject, merge_values from app.planning_org_email_sends
        where subject like 'We could not charge%'
      `;
      expect(send?.subject).toContain("We could not charge your card");

      // The link is a bearer credential. It belongs in the message and in the
      // job that delivers it, and nowhere a screen reads.
      expect(Object.keys(send?.merge_values ?? {})).not.toContain("payment_link");
      expect(Object.keys(send?.merge_values ?? {})).not.toContain("card_last4");
      expect(JSON.stringify(send?.merge_values ?? {})).not.toContain(token);

      // The deadline in the message is the instant the grace job will act on,
      // not a second reading of the clock a few minutes either side of it.
      const [job] = await sql<{ payload: { html: string } }[]>`
        select payload from app.planning_org_jobs
        where type = 'send_email' order by created_at desc limit 1
      `;
      expect(job?.payload.html).toContain(token);

      const after = await ordering.load(ctx.db, order.id);
      const deadline = new Intl.DateTimeFormat("en-CA", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "America/Toronto",
      }).format(after?.graceExpiresAt as Date);
      expect(job?.payload.html).toContain(deadline);
    });

    it("pays the balance through the link, and then the link is gone", async () => {
      const order = await book();
      await payDeposit(order.id);
      stripe.declineNextCharge();
      const declined = await chargeBalance(ctx, admin, order.id);
      const token = declined.link?.token as string;

      // Anonymous: the token is the authority, and the person whose card failed
      // may not have a session.
      const view = await openPaymentLink(ctx, token);
      expect(view.amount).toBe(order.balanceAmount);

      const checkout = await startLinkCheckout(ctx, token, LINK_URLS);
      expect(checkout.url).toContain("https://");

      // Nothing is paid yet — the customer is on the provider's page. The link
      // is deliberately still live: burning it here would leave somebody who
      // closed that page with a balance and no way to pay it.
      expect((await ordering.load(ctx.db, order.id))?.state).toBe("action_required");
      await expect(openPaymentLink(ctx, token)).resolves.toBeTruthy();

      await settleLinkCheckout(order.id, checkout.paymentId);

      const after = await ordering.load(ctx.db, order.id);
      expect(after?.state).toBe("confirmed");
      expect(after?.graceExpiresAt).toBeNull();

      // Single use. Now that it is paid, the same URL is a 404 — the same
      // answer as a token that never existed.
      await expect(openPaymentLink(ctx, token)).rejects.toBeInstanceOf(NotFoundError);
      await expect(startLinkCheckout(ctx, token, LINK_URLS)).rejects.toBeInstanceOf(NotFoundError);

      // And the row itself says so. The 404s above come from the order's state,
      // which is the first line; this is the second, and it is what would still
      // refuse the link if a later state ever made the first one true again.
      const row = await payments.loadPaymentLinkByToken(ctx.db, paymentLinkDigest(token));
      expect(row?.consumedAt).not.toBeNull();
    });

    it("re-opening the link before paying reuses one hosted checkout", async () => {
      const order = await book();
      await payDeposit(order.id);
      stripe.declineNextCharge();
      const declined = await chargeBalance(ctx, admin, order.id);
      const token = declined.link?.token as string;

      const first = await startLinkCheckout(ctx, token, LINK_URLS);
      const second = await startLinkCheckout(ctx, token, LINK_URLS);

      // Same attempt row, same idempotency key, same session. Opening the email
      // twice must not be two ways to be charged.
      expect(second.paymentId).toBe(first.paymentId);
      expect(second.url).toBe(first.url);
      expect(stripe.created.filter((row) => row.kind === "checkout_session")).toHaveLength(1);
    });

    it("refuses a link for a booking that has been cancelled", async () => {
      const order = await book();
      await payDeposit(order.id);
      stripe.declineNextCharge();
      const declined = await chargeBalance(ctx, admin, order.id);
      const token = declined.link?.token as string;

      // An administrator ends the booking while the customer still holds a live
      // link. Paying it would charge somebody for a booking nobody has, and the
      // webhook for that payment would then ask for a move the lifecycle
      // refuses — which the provider would retry for days.
      await cancelOrder(ctx, admin, order.id);

      await expect(openPaymentLink(ctx, token)).rejects.toBeInstanceOf(NotFoundError);
      await expect(startLinkCheckout(ctx, token, LINK_URLS)).rejects.toBeInstanceOf(NotFoundError);

      // Expired rather than consumed: nobody used it. The distinction is a
      // claim about the customer, so it has to be the right one.
      const row = await payments.loadPaymentLinkByToken(ctx.db, paymentLinkDigest(token));
      expect(row?.consumedAt).toBeNull();
      expect(row?.expiresAt.getTime()).toBeLessThanOrEqual(Date.now());
    });

    it("refuses a link once the balance has been paid another way", async () => {
      const order = await book();
      await payDeposit(order.id);
      stripe.declineNextCharge();
      const declined = await chargeBalance(ctx, admin, order.id);
      const token = declined.link?.token as string;

      // The retry succeeds on the card. The link the customer is still holding
      // must not be a second way to pay the same balance in full.
      const retried = await chargeBalance(ctx, admin, order.id);
      expect(retried.outcome).toBe("captured");

      await expect(openPaymentLink(ctx, token)).rejects.toBeInstanceOf(NotFoundError);
      await expect(startLinkCheckout(ctx, token, LINK_URLS)).rejects.toBeInstanceOf(NotFoundError);

      const captured = await payments.netCaptured(ctx.db, order.id);
      expect(captured).toBe(order.total);

      // Retired by the move out of `action_required`, not by anybody
      // remembering to do it on the balance path.
      const row = await payments.loadPaymentLinkByToken(ctx.db, paymentLinkDigest(token));
      expect(row?.consumedAt).not.toBeNull();
    });

    it("refuses a token that has expired", async () => {
      const order = await book();
      await payDeposit(order.id);
      stripe.declineNextCharge();
      const declined = await chargeBalance(ctx, admin, order.id);

      await sql`
        update app.planning_org_payment_links set expires_at = now() - interval '1 hour'
        where order_id = ${order.id}
      `;

      await expect(openPaymentLink(ctx, declined.link?.token as string)).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });

    it("does not charge twice when a balance attempt times out and the job is retried", async () => {
      const order = await book();
      await payDeposit(order.id);

      // The provider took the charge and then the call failed, so this platform
      // never learned the outcome. The attempt row is left `pending`.
      stripe.failNextWith("chargeOffSession", new Error("gateway timeout"));
      await expect(chargeBalance(ctx, admin, order.id)).rejects.toThrow("gateway timeout");

      const afterFirst = stripe.created.filter((row) => row.kind === "payment_intent");

      // The job runs again. Opening a second attempt row here would mint a
      // second idempotency key, and the provider would charge the card again.
      await chargeBalance(ctx, admin, order.id);

      expect(stripe.created.filter((row) => row.kind === "payment_intent")).toHaveLength(
        afterFirst.length,
      );

      const attempts = await payments.listPayments(ctx.db, order.id);
      expect(attempts.filter((attempt) => attempt.kind === "balance")).toHaveLength(1);
    });

    it("does not extend the grace window with every decline", async () => {
      const order = await book();
      await payDeposit(order.id);

      stripe.declineNextCharge();
      const first = await chargeBalance(ctx, admin, order.id);

      stripe.declineNextCharge();
      const second = await chargeBalance(ctx, admin, order.id);

      // A fresh link, the same deadline: a failing card must not be able to
      // extend the window indefinitely.
      expect(second.link?.token).not.toBe(first.link?.token);
      expect(second.link?.expiresAt).toEqual(first.link?.expiresAt);
    });
  });

  describe("transfers", () => {
    it("pays the vendor their share of the deposit, once", async () => {
      const order = await book();
      await payDeposit(order.id);

      const first = await transferShare(ctx, admin, order.id, "deposit_share");
      const second = await transferShare(ctx, admin, order.id, "deposit_share");

      expect(first.state).toBe("paid");
      expect(second.state).toBe("paid");
      expect(second.transferId).toBe(first.transferId);

      // `(order_id, kind)` is unique, so the retry adopted the first claim
      // rather than opening a second.
      const moved = stripe.created.filter((row) => row.kind === "transfer");
      expect(moved).toHaveLength(1);
    });

    it("parks a payout for a suspended vendor instead of paying it", async () => {
      const order = await book();
      await payDeposit(order.id);

      await sql`update app.planning_org_vendors set status = 'suspended' where id = ${bloomVendorId}`;

      const result = await transferShare(ctx, admin, order.id, "deposit_share");

      expect(result.state).toBe("held");
      expect(result.reason).toMatch(/suspended/);
      expect(stripe.created.filter((row) => row.kind === "transfer")).toHaveLength(0);

      const held = await payments.loadTransfer(ctx.db, order.id, "deposit_share");
      expect(held?.state).toBe("held");

      // And it reaches an administrator: the vendor's own record lists what is
      // parked, so a payout that stopped is something somebody can find rather
      // than a row nobody looks at.
      const record = await getVendorDetail(ctx, admin, bloomVendorId);
      expect(record.heldTransfers.map((row) => row.orderReference)).toContain(order.reference);
      expect(record.heldTransfers[0]?.heldReason).toMatch(/suspended/);
    });

    it("parks a payout for an order somebody has raised a problem with", async () => {
      const order = await book();
      await payDeposit(order.id);
      await raiseIssue(ctx, admin, order.id, "The flowers arrived wilted.");

      const result = await transferShare(ctx, admin, order.id, "deposit_share");

      // `issue` looks exactly like `confirmed` to a query that reads amounts.
      expect(result.state).toBe("held");
      expect(result.reason).toMatch(/issue/);
    });

    it("splits the vendor's share so the two transfers reconcile to the order", async () => {
      const order = await book();
      await payDeposit(order.id);
      await chargeBalance(ctx, admin, order.id);

      await transferShare(ctx, admin, order.id, "deposit_share");
      await markFulfilled(ctx, admin, order.id);
      await autoComplete(ctx, admin, order.id);
      await transferShare(ctx, admin, order.id, "balance_share");

      const row = await ordering.load(ctx.db, order.id);
      const moved = await payments.listTransfers(ctx.db, order.id);
      const paidOut = moved.reduce((sum, transfer) => sum + transfer.amount, 0n);
      const captured = await payments.netCaptured(ctx.db, order.id);

      // Everything the customer paid is what the vendor got plus what the
      // platform kept.
      expect(paidOut + (row?.commission as bigint) + (row?.commissionTax as bigint)).toBe(captured);
      expect(captured).toBe(row?.total);
    });
  });

  describe("fulfilment and completion", () => {
    it("runs deposit → confirmed → fulfilled → completed with a real caller for each", async () => {
      const order = await book();
      await payDeposit(order.id);
      await chargeBalance(ctx, admin, order.id);

      const fulfilled = await markFulfilled(ctx, admin, order.id);
      expect(fulfilled.to).toBe("fulfilled");
      // Marking it delivered is what schedules the completion.
      expect(fulfilled.jobsQueued).toEqual(["auto_complete_order"]);

      const afterFulfil = await ordering.load(ctx.db, order.id);
      expect(afterFulfil?.autoCompleteAt).not.toBeNull();

      const completed = await autoComplete(ctx, admin, order.id);
      expect(completed.to).toBe("completed");

      // A finished order keeps its date: it was used, not freed.
      const blocks = await ordering.listCapacityBlocks(ctx.db, order.id);
      expect(blocks.every((block) => block.active)).toBe(true);
    });

    it("refuses a move the lifecycle does not have", async () => {
      const order = await book();
      // `pending_payment → fulfilled` is not a row in the table.
      await expect(markFulfilled(ctx, admin, order.id)).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe("capacity on every terminal state", () => {
    it("releases the date when a booking is cancelled", async () => {
      const order = await book();
      await payDeposit(order.id);

      const refund = await refundWithinCoolingWindow(ctx, admin, order.id);
      expect(refund.state).toBe("settled");

      const after = await ordering.load(ctx.db, order.id);
      expect(after?.state).toBe("refunded");

      const blocks = await ordering.listCapacityBlocks(ctx.db, order.id);
      expect(blocks.every((block) => block.active)).toBe(false);

      // And the date is genuinely free again: the same booking can be made.
      await expect(book()).resolves.toBeTruthy();
    });

    it("calls off the work an ended order had queued", async () => {
      const order = await book();
      await payDeposit(order.id);

      await refundWithinCoolingWindow(ctx, admin, order.id);

      const jobs = await ordering.listJobsForOrder(ctx.db, order.id);
      expect(jobs.filter((job) => job.status === "queued")).toHaveLength(0);
    });
  });

  describe("a charge that lands after the booking has gone", () => {
    /**
     * The race the expiry exists inside, played out in order.
     *
     * The hold falls due while nobody has paid, so the booking is cancelled and
     * the date goes back on the vendor's calendar. Then the customer's card
     * settles anyway.
     */
    async function captureAfterCancellation() {
      const order = await book();
      const deposit = await chargeDeposit(ctx, customer, order.id);

      await sql`
        update app.planning_org_jobs set run_after = now() - interval '10 years'
        where type = 'expire_unpaid' and payload ->> 'orderId' = ${order.id}
      `;
      await runDueJobs(ctx, { asOf: new Date(), demoOnly: false, trigger: "cron" });
      expect((await ordering.load(ctx.db, order.id))?.state).toBe("cancelled");

      // The provider took the money regardless — a capture already in flight
      // when the cancel was asked for.
      stripe.settleCheckoutSession(deposit.providerPaymentIntentId);
      const intent = await stripe.retrievePaymentIntent(deposit.providerPaymentIntentId);

      return {
        order,
        deposit,
        event: {
          type: "payment_intent.succeeded",
          object: {
            id: deposit.providerPaymentIntentId,
            latest_charge: intent?.chargeId,
            metadata: { order_id: order.id, payment_id: deposit.paymentId },
          },
        },
      };
    }

    it("gives it back, under the platform's own principal", async () => {
      const { order, deposit, event } = await captureAfterCancellation();

      const applied = await applyWebhook(ctx, event);
      expect(applied.applied).toBe(true);

      const refunds = await payments.listRefunds(ctx.db, order.id);
      expect(refunds).toHaveLength(1);
      expect(refunds[0]?.state).toBe("settled");
      expect(refunds[0]?.paymentId).toBe(deposit.paymentId);
      expect(await payments.netCaptured(ctx.db, order.id)).toBe(0n);

      // The order made its move already and does not make it twice.
      expect((await ordering.load(ctx.db, order.id))?.state).toBe("cancelled");

      // Nobody asked for this refund; the platform did, and the trail says so
      // rather than naming a person who was not there.
      const [entry] = await sql<{ actor_user_id: string | null; acting_role: string | null }[]>`
        select actor_user_id, acting_role from app.planning_org_audit_log
        where action = 'payment.refunded_late_capture' and entity_id = ${order.id}
      `;
      expect(entry).toBeDefined();
      expect(entry?.actor_user_id).toBeNull();
    });

    it("refunds once however many times the event is delivered", async () => {
      // Two layers stand between a replay and a second refund. The webhook
      // table's own unique event id is the first; this is the second, and it is
      // the one that holds when the provider re-sends under a fresh id — the
      // key is derived from the refund row, so a branch that opened a second
      // row would mint a second key and give the money back twice.
      const { order, event } = await captureAfterCancellation();

      const first = await applyWebhook(ctx, event);
      const second = await applyWebhook(ctx, event);
      const third = await applyWebhook(ctx, event);

      expect(first.applied).toBe(true);
      expect(second.applied).toBe(false);
      expect(third.applied).toBe(false);

      expect(await payments.listRefunds(ctx.db, order.id)).toHaveLength(1);
      expect(stripe.created.filter((row) => row.kind === "refund")).toHaveLength(1);
    });

    it("leaves a completed booking's money where it is", async () => {
      // A finished order is not the same thing as a released date. A charge
      // settling late against a booking that actually happened is money the
      // vendor earned, and giving it back would take a fee for a party that
      // took place — so the refund turns on the date having been released,
      // which `completed` never does.
      const order = await bookForEventIn(30);
      await payDeposit(order.id);
      await markFulfilled(ctx, admin, order.id);
      await autoComplete(ctx, admin, order.id);
      expect((await ordering.load(ctx.db, order.id))?.state).toBe("completed");

      const settled = await payments.succeededPaymentOfKind(ctx.db, order.id, "deposit");
      const replay = applyWebhook(ctx, {
        type: "payment_intent.succeeded",
        object: {
          id: settled?.providerPaymentIntentId,
          metadata: { order_id: order.id, payment_id: settled?.id },
        },
      });

      // The order refuses to confirm again, which is the lifecycle's own
      // answer and not this branch's. What matters here is what did *not*
      // happen on the way to it.
      await expect(replay).rejects.toThrow(ValidationError);
      expect(await payments.listRefunds(ctx.db, order.id)).toHaveLength(0);
      expect(await payments.netCaptured(ctx.db, order.id)).toBe(settled?.amount);
    });
  });

  describe("refunds", () => {
    it("refunds every charge that holds money, not just the first", async () => {
      // A booking fifteen days out. The balance falls due at event−14d, which
      // is inside the forty-eight hour free-cancellation window — so both
      // charges have settled by the time somebody cancels. Refunding their sum
      // against the deposit's own intent asks the provider to return more than
      // that charge ever held.
      const order = await bookForEventIn(15);
      await payDeposit(order.id);
      await chargeBalance(ctx, admin, order.id);

      const captured = await payments.netCaptured(ctx.db, order.id);
      expect(captured).toBe(order.total);
      expect(order.balanceAmount).toBeGreaterThan(0n);

      const refund = await refundWithinCoolingWindow(ctx, admin, order.id);

      expect(refund.amount).toBe(captured);
      expect(refund.refundIds).toHaveLength(2);

      // Each refund is against its own charge, and none exceeds it.
      const rows = await payments.listRefunds(ctx.db, order.id);
      const paid = await payments.listPayments(ctx.db, order.id);
      for (const row of rows) {
        const against = paid.find((payment) => payment.id === row.paymentId);
        expect(row.amount).toBe(against?.amount);
      }

      expect(await payments.netCaptured(ctx.db, order.id)).toBe(0n);
      expect((await ordering.load(ctx.db, order.id))?.state).toBe("refunded");
    });

    it("reads a fully refunded order as holding nothing, seeded or written here", async () => {
      // The seed marks a refunded payment `refunded`; this domain leaves it
      // `succeeded` and records a settled refund beside it. `netCaptured` has to
      // agree with both, or a fully refunded order reads as owing the customer
      // money that has already gone back — which is what bounds an admin's
      // dashboard-refund entry and what decides whether a payout still has
      // funds behind it.
      const [seeded] = await sql<{ id: string }[]>`
        select id from app.planning_org_orders where reference = 'TO-4171'
      `;
      expect(await payments.netCaptured(ctx.db, seeded?.id as string)).toBe(0n);

      // And the same situation reached through the domain.
      const order = await book();
      await payDeposit(order.id);
      await refundWithinCoolingWindow(ctx, admin, order.id);
      expect(await payments.netCaptured(ctx.db, order.id)).toBe(0n);

      // Both conventions end up written the same way, so a screen labelling a
      // payment does not have to know which wrote it.
      const rows = await payments.listPayments(ctx.db, order.id);
      expect(rows.map((row) => row.state)).toEqual(["refunded"]);
    });

    it("refuses an in-app refund once the free window has closed", async () => {
      const order = await book();
      await payDeposit(order.id);

      await sql`
        update app.planning_org_orders set cooling_window_ends_at = now() - interval '1 hour'
        where id = ${order.id}
      `;

      await expect(refundWithinCoolingWindow(ctx, admin, order.id)).rejects.toBeInstanceOf(
        ValidationError,
      );
    });

    it("refuses to refund in-app once the vendor has been paid", async () => {
      const order = await book();
      await payDeposit(order.id);
      await transferShare(ctx, admin, order.id, "deposit_share");

      // The vendor has the money. A silent customer-side refund here would
      // leave the platform out of pocket with nothing recording it.
      await expect(refundWithinCoolingWindow(ctx, admin, order.id)).rejects.toBeInstanceOf(
        ValidationError,
      );
    });

    it("records a dashboard refund, and flags one the vendor has already been paid for", async () => {
      const order = await book();
      await payDeposit(order.id);
      await transferShare(ctx, admin, order.id, "deposit_share");

      const captured = await payments.netCaptured(ctx.db, order.id);
      const result = await recordExternalRefund(ctx, admin, order.id, {
        providerRefundId: "re_3QdashboardRefund01",
        amount: captured,
        reason: "Vendor cancelled; refunded in the dashboard.",
      });

      expect(result.state).toBe("needs_attention");
      const after = await ordering.load(ctx.db, order.id);
      expect(after?.state).toBe("refunded");
    });

    it("refuses an amount larger than what is still captured", async () => {
      const order = await book();
      await payDeposit(order.id);

      await expect(
        recordExternalRefund(ctx, admin, order.id, {
          providerRefundId: "re_3QtooMuch01",
          amount: 999_999_99n,
          reason: "too much",
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("refuses something that is not a provider refund id", async () => {
      const order = await book();
      await payDeposit(order.id);

      await expect(
        recordExternalRefund(ctx, admin, order.id, {
          providerRefundId: "I refunded it, honest",
          amount: 100n,
          reason: "x",
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe("idempotency past the provider's window", () => {
    it("adopts an existing charge rather than making a second one", async () => {
      const order = await book();

      // The first attempt created a charge at the provider and then the network
      // failed, so this platform never learned its id.
      stripe.failNextWith("createPaymentIntent", new Error("gateway timeout"));
      await expect(chargeDeposit(ctx, customer, order.id)).rejects.toThrow("gateway timeout");

      const before = stripe.created.filter((row) => row.kind === "payment_intent");
      expect(before).toHaveLength(1);

      // Long enough that the key is no longer remembered — the exact condition
      // under which retrying with it charges a second time.
      stripe.expireIdempotencyKeys();
      database.setRealNow(new Date(Date.now() + RETRY_CEILING_MS + 60_000));

      await chargeDeposit(ctx, customer, order.id);

      const after = stripe.created.filter((row) => row.kind === "payment_intent");
      expect(after).toHaveLength(1);
    });

    it("lets the key do the work while it is still inside the window", async () => {
      const order = await book();

      stripe.failNextWith("createPaymentIntent", new Error("gateway timeout"));
      await expect(chargeDeposit(ctx, customer, order.id)).rejects.toThrow("gateway timeout");

      // No clock movement: the key is still live, so the retry is deduplicated
      // by the provider rather than by a lookup.
      await chargeDeposit(ctx, customer, order.id);

      expect(stripe.created.filter((row) => row.kind === "payment_intent")).toHaveLength(1);
    });
  });

  describe("who may do what", () => {
    it("refuses a customer acting on somebody else's order", async () => {
      const order = await book();

      signInAs("ada.okafor@example.ca");
      const other = await getActor(ctx, {});

      await expect(getOrder(ctx, other, order.id)).rejects.toBeInstanceOf(NotFoundError);
      await expect(markFulfilled(ctx, other, order.id)).rejects.toBeInstanceOf(NotFoundError);
    });

    it("refuses the vendor's own staff any path that charges the customer's card", async () => {
      const order = await book();

      // Rosa works at Bloom & Co, the vendor on this order. She may act on the
      // booking — that is what `assertCanActOnOrder` is for — but making a
      // charge happen on the customer's saved card is not acting on a booking,
      // and a vendor who could do it could help themselves.
      signInAs("rosa@bloomandco.ca");
      const staff = await getActor(ctx, {});

      await expect(chargeDeposit(ctx, staff, order.id)).rejects.toBeInstanceOf(NotFoundError);
      await expect(chargeBalance(ctx, staff, order.id)).rejects.toBeInstanceOf(NotFoundError);
      await expect(refundWithinCoolingWindow(ctx, staff, order.id)).rejects.toBeInstanceOf(
        NotFoundError,
      );

      // Nothing reached the provider.
      expect(stripe.created.filter((row) => row.kind === "payment_intent")).toHaveLength(0);
    });

    it("refuses a customer releasing their own booking's payout", async () => {
      const order = await book();
      await payDeposit(order.id);

      // Reading and paying for their own order is theirs; deciding the vendor
      // gets paid is not.
      await expect(transferShare(ctx, customer, order.id, "deposit_share")).rejects.toBeInstanceOf(
        NotFoundError,
      );
      await expect(autoComplete(ctx, customer, order.id)).rejects.toBeInstanceOf(NotFoundError);

      expect(stripe.created.filter((row) => row.kind === "transfer")).toHaveLength(0);
    });

    it("refuses a non-admin recording a dashboard refund", async () => {
      const order = await book();
      await payDeposit(order.id);

      await expect(
        recordExternalRefund(ctx, customer, order.id, {
          providerRefundId: "re_3QtooMuch01",
          amount: 100n,
          reason: "x",
        }),
      ).rejects.toThrow();
    });
  });
});
