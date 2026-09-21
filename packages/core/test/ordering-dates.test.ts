import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type postgres from "postgres";
import type { Actor } from "../src/identity/actor.js";
import type { CoreContext } from "../src/context.js";
import { getActor } from "../src/identity/service.js";
import { createCheckout } from "../src/ordering/service.js";
import * as ordering from "../src/ordering/repo.js";
import { applyWebhook, chargeDeposit } from "../src/payments/service.js";
import { updateSetting } from "../src/reference/service.js";
import { createStripeFake, type StripeFake } from "../src/testing/stripe-fake.js";
import { createDatabaseContext, ownerSql, resetDatabase, testDatabaseUrl } from "./harness.js";

/**
 * The order's date columns against the work actually queued for them.
 *
 * `balance_due_at` is the one deadline a customer is shown before anything is
 * charged, and the job that charges it is scheduled separately. They were
 * derived from two different numbers — one read from `platform_settings`, one a
 * literal in the lifecycle table — so an administrator changing the lead time
 * moved the date on the screen and nothing else. Nobody was charged late; the
 * booking simply promised one day and the platform worked to another.
 *
 * So every claim here is a comparison: the column against the job, at a lead
 * time that is *not* the seeded default, because at fourteen days the two
 * numbers agree by accident and a test written there would have passed before
 * the fix.
 */

const url = testDatabaseUrl();

describe.skipIf(!url)("order dates and the work queued for them", () => {
  const dbUrl = url as string;
  let sql: postgres.Sql;
  let database: ReturnType<typeof createDatabaseContext>;
  let ctx: CoreContext;
  let stripe: StripeFake;
  let admin: Actor;
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
    await sql`
      update app.planning_org_vendors
      set stripe_account_id = 'acct_test_' || left(id::text, 8),
          stripe_payouts_enabled_at = now()
      where status = 'approved'
    `;

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

  /** A booking whose event is a given number of days away. */
  async function bookForEventIn(days: number) {
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
      lines: [{ serviceId: bloomServiceId, quantity: 4 }],
    });
    return result.orders[0] as NonNullable<(typeof result.orders)[number]>;
  }

  /** Takes the deposit and settles it, which is what confirms the order. */
  async function payDeposit(orderId: string) {
    signInAs("sarah@example.ca");
    const deposit = await chargeDeposit(ctx, customer, orderId);

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
  }

  async function setLeadDays(days: number) {
    signInAs("admin@occasion.test");
    await updateSetting(ctx, admin, "balance_lead_days", String(days));
  }

  /** The queued balance charge for an order, addressed the way the domain does. */
  async function balanceJob(orderId: string) {
    const [row] = await sql<{ run_after: Date; status: string }[]>`
      select run_after, status from app.planning_org_jobs
      where type = 'charge_balance' and dedupe_key = ${`charge_balance:${orderId}`}
    `;
    return row;
  }

  async function orderDates(orderId: string) {
    const [row] = await sql<
      { balance_due_at: Date | null; balance_amount: string; event_date: string }[]
    >`
      select o.balance_due_at, o.balance_amount::text, e.event_date::text as event_date
      from app.planning_org_orders o
      join app.planning_org_events e on e.id = o.event_id
      where o.id = ${orderId}
    `;
    return row;
  }

  it("charges the balance on the day the order says it is due", async () => {
    await setLeadDays(21);

    const order = await bookForEventIn(120);
    await payDeposit(order.id);

    expect((await ordering.load(ctx.db, order.id))?.state).toBe("confirmed");

    const dates = await orderDates(order.id);
    const job = await balanceJob(order.id);

    expect(job, "no balance charge was queued").toBeDefined();
    expect(dates?.balance_due_at).not.toBeNull();
    // The claim: one instant, not two that happen to agree.
    expect(dates?.balance_due_at?.getTime()).toBe(job?.run_after.getTime());

    // And it is the setting that decides, in the event's own zone: the event is
    // the 120th day away and the charge lands on the 99th.
    const [expected] = await sql<{ day: string }[]>`
      select ((${dates?.event_date as string}::date) - 21)::text as day
    `;
    const [landsOn] = await sql<{ day: string }[]>`
      select (${job?.run_after as Date}::timestamptz at time zone 'America/Toronto')::date::text
        as day
    `;
    expect(landsOn?.day).toBe(expected?.day);
  });

  it("keeps the two together when the lead time changes between booking and payment", async () => {
    // The stronger form of the same claim. Booked under one lead time and
    // confirmed under another, the column still names the day the queued job
    // runs — which is only true if one computation produces both.
    await setLeadDays(14);
    const order = await bookForEventIn(120);

    await setLeadDays(21);
    await payDeposit(order.id);

    const dates = await orderDates(order.id);
    const job = await balanceJob(order.id);

    expect(dates?.balance_due_at?.getTime()).toBe(job?.run_after.getTime());

    const [expected] = await sql<{ day: string }[]>`
      select ((${dates?.event_date as string}::date) - 21)::text as day
    `;
    const [landsOn] = await sql<{ day: string }[]>`
      select (${job?.run_after as Date}::timestamptz at time zone 'America/Toronto')::date::text
        as day
    `;
    expect(landsOn?.day).toBe(expected?.day);
  });

  it("takes an event inside the lead window in full, and queues no balance charge", async () => {
    await setLeadDays(21);

    // Eighteen days out: inside a twenty-one day lead time, so the balance
    // would be due before the booking was made. Scheduling the charge anyway
    // queues work whose due date is in the past — immediately due, and throwing
    // every time the runner picks it up.
    const order = await bookForEventIn(18);
    expect(order.balanceAmount).toBe(0n);
    expect(order.balanceDueAt).toBeNull();

    await payDeposit(order.id);
    expect((await ordering.load(ctx.db, order.id))?.state).toBe("confirmed");

    expect(await balanceJob(order.id)).toBeUndefined();
    expect((await orderDates(order.id))?.balance_due_at).toBeNull();
  });

  it("still splits an event just outside the same window", async () => {
    // The boundary the case above is only half of: at twenty-two days the
    // ordinary deposit-and-balance shape is back, so "pays in full" is the
    // lead time doing its job rather than the threshold swallowing everything.
    await setLeadDays(21);

    const order = await bookForEventIn(22);
    expect(order.balanceAmount).toBeGreaterThan(0n);

    await payDeposit(order.id);
    expect(await balanceJob(order.id)).toBeDefined();
  });
});
