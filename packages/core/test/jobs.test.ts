import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type postgres from "postgres";
import type { Actor } from "../src/identity/actor.js";
import { SYSTEM, isAuthenticated, isUsable } from "../src/identity/actor.js";
import type { CoreContext } from "../src/context.js";
import { createCoreContext } from "../src/context.js";
import { NotFoundError, ValidationError } from "../src/errors.js";
import { getActor, requireAdmin } from "../src/identity/service.js";
import {
  assertCanActOnOrder,
  assertCanActOnUser,
  assertCanActOnVendor,
  assertCanPayOrder,
  assertCanReadEvent,
  assertCanReadOrder,
  assertCanReadUser,
  assertCanReadVendorPrivately,
} from "../src/identity/policies.js";
import { demoClockStates } from "../src/clock/demo-states.js";
import {
  clearAllOverrides,
  readOverride,
  setOverride,
  OVERRIDE_TTL_MINUTES,
} from "../src/clock/override.js";
import { reseedBlockers, runDemoJobs, getOpsView } from "../src/jobs/admin-service.js";
import * as jobsRepo from "../src/jobs/repo.js";
import { runDueJobs } from "../src/jobs/runner.js";
import {
  createCheckout,
  markFulfilled,
  raiseIssue,
  resolveIssue,
} from "../src/ordering/service.js";
import * as ordering from "../src/ordering/repo.js";
import * as payments from "../src/payments/repo.js";
import { applyWebhook, chargeDeposit, sweepParkedWebhooks } from "../src/payments/service.js";
import type { StripeFake } from "../src/testing/stripe-fake.js";
import { createStripeFake } from "../src/testing/stripe-fake.js";
import { createDatabaseContext, ownerSql, resetDatabase, testDatabaseUrl } from "./harness.js";

/**
 * The job runner, the clock override, and the line between them.
 *
 * The claim this suite exists for is the one in the middle: **a shifted clock
 * cannot reach a real order**. Everything else here — idempotence, the
 * concurrent claim, the backoff — is machinery that a careful reading could
 * mostly confirm. That one is a rule about money, it spans three layers, and
 * the failure it prevents is silent: a demo run that claimed real balance
 * charges would charge those cards *and* consume their dedupe keys, so the
 * genuine run on the genuine date would find nothing to do and say so.
 */

const url = testDatabaseUrl();

describe.skipIf(!url)("jobs and the clock", () => {
  const dbUrl = url as string;
  let sql: postgres.Sql;
  let database: ReturnType<typeof createDatabaseContext>;
  let ctx: CoreContext;
  let stripe: StripeFake;
  let admin: Actor;
  let customer: Actor;

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
    bookings = 0;
    database = createDatabaseContext(dbUrl, stripe);
    ctx = database.ctx;

    await sql`update app.planning_org_users set auth_provider_sub = 'provider-sub-' || email`;
    await sql`
      update app.planning_org_vendors
      set stripe_account_id = 'acct_test_' || left(id::text, 8),
          stripe_payouts_enabled_at = now()
      where status = 'approved'
    `;

    admin = await actorFor("admin@occasion.test");
    customer = await actorFor("sarah@example.ca");
  });

  async function actorFor(email: string): Promise<Actor> {
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
   * A booking made through the domain, with its deposit settled.
   *
   * Each one lands on its own date. The exclusion constraint is real — two
   * bookings of one service on one day is exactly what it refuses — so a suite
   * that wants two live orders has to give them two dates.
   */
  let bookings = 0;

  /**
   * A checkout that reached the provider and stopped there.
   *
   * The state an abandoned cart is in: the order `pending_payment`, its dates
   * held, an open deposit attempt, and an intent nobody confirmed. What the
   * expiry is for.
   */
  async function startCheckout(options: { demo: boolean; days?: number } = { demo: true }) {
    bookings += 1;
    const [event] = await sql<{ id: string }[]>`
      insert into app.planning_org_events (owner_user_id, name, event_date, start_time, timezone)
      values (
        (select id from app.planning_org_users where email = 'sarah@example.ca'),
        ${`Booking ${Math.random()}`},
        (now() + (${options.days ?? 60 + bookings * 7} || ' days')::interval)::date,
        '17:00',
        'America/Toronto'
      )
      returning id
    `;
    const [service] = await sql<{ id: string }[]>`
      select s.id from app.planning_org_services s
      join app.planning_org_vendors v on v.id = s.vendor_id
      where v.slug = 'bloom-and-co' and v.status = 'approved' limit 1
    `;

    const checkout = await createCheckout(ctx, customer, {
      eventId: event?.id as string,
      lines: [{ serviceId: service?.id as string, quantity: 4 }],
    });
    const order = checkout.orders[0] as NonNullable<(typeof checkout.orders)[number]>;

    // Which side of the demo filter a row lands on is decided by the tier the
    // checkout ran under, and this suite is about the filter rather than about
    // the tier: every row is put on the side the test names, whatever the
    // context it was created in would have written.
    await sql`
      update app.planning_org_orders set is_demo = ${options.demo} where id = ${order.id}
    `;
    await sql`
      update app.planning_org_jobs set is_demo = ${options.demo}
      where payload ->> 'orderId' = ${order.id}
    `;

    const deposit = await chargeDeposit(ctx, customer, order.id);
    return { order, deposit };
  }

  async function bookAndPayDeposit(options: { demo: boolean; days?: number } = { demo: true }) {
    const { order, deposit } = await startCheckout(options);

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

    await sql`
      update app.planning_org_jobs set is_demo = ${options.demo}
      where payload ->> 'orderId' = ${order.id}
    `;

    return order;
  }

  async function jobStatus(orderId: string, type: string) {
    const [row] = await sql<
      {
        status: string;
        held_reason: string | null;
        attempts: number;
        run_after: Date;
        last_error: string | null;
      }[]
    >`
      select status::text, held_reason, attempts, run_after, last_error
      from app.planning_org_jobs
      where type = ${type}::app.job_type and payload ->> 'orderId' = ${orderId}
    `;
    return row;
  }

  /** Brings a job forward so the next run is certain to claim it first. */
  async function makeOverdue(orderId: string, type: string): Promise<void> {
    await sql`
      update app.planning_org_jobs set run_after = now() - interval '10 years'
      where type = ${type}::app.job_type and payload ->> 'orderId' = ${orderId}
    `;
  }

  async function activeBlocks(orderId: string): Promise<number> {
    const blocks = await ordering.listCapacityBlocks(ctx.db, orderId);
    return blocks.filter((block) => block.active).length;
  }

  /** Far enough ahead that everything the seed queued is due. */
  function farFuture(): Date {
    return new Date(Date.now() + 400 * 24 * 3_600_000);
  }

  describe("what a checkout flags its order with", () => {
    /** Books through the domain in a given context, returning the order's flag. */
    async function flagOfBookingIn(context: CoreContext, days: number): Promise<boolean> {
      const [event] = await sql<{ id: string }[]>`
        insert into app.planning_org_events (owner_user_id, name, event_date, start_time, timezone)
        values (
          (select id from app.planning_org_users where email = 'sarah@example.ca'),
          ${`Flag ${days}`},
          (now() + (${days} || ' days')::interval)::date,
          '17:00',
          'America/Toronto'
        )
        returning id
      `;
      const [service] = await sql<{ id: string }[]>`
        select s.id from app.planning_org_services s
        join app.planning_org_vendors v on v.id = s.vendor_id
        where v.slug = 'bloom-and-co' and v.status = 'approved' limit 1
      `;

      const checkout = await createCheckout(context, customer, {
        eventId: event?.id as string,
        lines: [{ serviceId: service?.id as string, quantity: 4 }],
      });
      const order = checkout.orders[0] as NonNullable<(typeof checkout.orders)[number]>;
      return (await ordering.load(context.db, order.id))?.isDemo as boolean;
    }

    it("flags it for the preview exactly when the clock can be moved", async () => {
      // The demo is the whole point of the deployment, and it can only drive an
      // order the runner is allowed to claim. Reading the flag off the tier is
      // what keeps that from also reaching a real customer: a deployment that
      // may not move its clock cannot write the flag, and the boot check that
      // refuses the two together is what makes it a guarantee rather than care.
      expect(ctx.config.allowClockOverride).toBe(true);
      expect(await flagOfBookingIn(ctx, 210)).toBe(true);

      const production = productionContext();
      expect(production.config.allowClockOverride).toBe(false);
      expect(await flagOfBookingIn(production, 217)).toBe(false);
    });
  });

  describe("the demo filter", () => {
    it("will not let a shifted clock claim a real order's job", async () => {
      // The headline. A real booking with a balance charge due in a year, and a
      // demo run jumped past it.
      const real = await bookAndPayDeposit({ demo: false });
      const demo = await bookAndPayDeposit({ demo: true });

      const summary = await runDueJobs(ctx, {
        asOf: farFuture(),
        demoOnly: true,
        trigger: "admin_button",
      });

      // Measured from `job_runs` — what the runner actually executed — rather
      // than from the jobs' statuses. The lifecycle marks a job `done` when it
      // calls one off, so a confirmed order has a cancelled `expire_unpaid`
      // that the runner never saw.
      const touched = new Set(
        (
          await sql<{ order_id: string }[]>`
            select distinct j.payload ->> 'orderId' as order_id
            from app.planning_org_job_runs r
            join app.planning_org_jobs j on j.id = r.job_id
          `
        ).map((row) => row.order_id),
      );

      expect(summary.claimed).toBeGreaterThan(0);
      expect(touched.has(demo.id)).toBe(true);
      expect(touched.has(real.id)).toBe(false);

      // And nothing was charged on it, which is the thing that would have been
      // irreversible.
      const charges = await payments.listPayments(ctx.db, real.id);
      expect(charges.filter((payment) => payment.kind === "balance")).toHaveLength(0);
    });

    it("leaves the real job claimable afterwards, with its key unconsumed", async () => {
      // The second half, and the one that makes the first half matter: if the
      // demo run had claimed it, the dedupe key would be spent and the real run
      // on the real date would find nothing and report success.
      const real = await bookAndPayDeposit({ demo: false });

      await runDueJobs(ctx, { asOf: farFuture(), demoOnly: true, trigger: "admin_button" });
      const summary = await runDueJobs(ctx, {
        asOf: farFuture(),
        demoOnly: false,
        trigger: "cron",
      });

      expect(summary.claimed).toBeGreaterThan(0);
      const balance = await payments.succeededPaymentOfKind(ctx.db, real.id, "balance");
      expect(balance).toBeTruthy();
    });

    it("still runs a demo job that is about no order at all", async () => {
      // The quote request's expiry names no order, so a filter written as "the
      // order must be demo" would silently exclude it for ever.
      const summary = await runDueJobs(ctx, {
        asOf: farFuture(),
        demoOnly: true,
        trigger: "admin_button",
      });

      expect(summary.results.some((result) => result.type === "expire_quote_request")).toBe(true);

      const [request] = await sql<{ state: string }[]>`
        select state::text from app.planning_org_quote_requests limit 1
      `;
      expect(request?.state).toBe("expired");
    });
  });

  describe("claiming", () => {
    it("takes nothing that is not due yet", async () => {
      const summary = await runDueJobs(ctx, {
        asOf: new Date(),
        demoOnly: false,
        trigger: "cron",
      });

      // The seeded auto-complete on the delivered order is genuinely due; the
      // balance charges nine months out are not.
      expect(summary.results.every((result) => result.type !== "charge_balance")).toBe(true);
    });

    it("never hands the same job to two runners", async () => {
      // `for update skip locked`. Without it the second runner blocks on the
      // first's rows and then processes them again.
      const [first, second] = await Promise.all([
        runDueJobs(ctx, { asOf: farFuture(), demoOnly: false, trigger: "cron" }),
        runDueJobs(ctx, { asOf: farFuture(), demoOnly: false, trigger: "cron" }),
      ]);

      const ids = [...first.results, ...second.results].map((result) => result.jobId);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("does not charge twice when the runner runs twice", async () => {
      const order = await bookAndPayDeposit({ demo: true });

      await runDueJobs(ctx, { asOf: farFuture(), demoOnly: false, trigger: "cron" });
      await runDueJobs(ctx, { asOf: farFuture(), demoOnly: false, trigger: "cron" });

      const charged = (await payments.listPayments(ctx.db, order.id)).filter(
        (payment) => payment.kind === "balance" && payment.state === "succeeded",
      );
      expect(charged).toHaveLength(1);

      const transfers = await payments.listTransfers(ctx.db, order.id);
      expect(new Set(transfers.map((transfer) => transfer.kind)).size).toBe(transfers.length);
    });
  });

  describe("provenance", () => {
    it("records the time it believed it was, the real time, and whose override", async () => {
      const at = farFuture();
      await setOverride(ctx, admin, at);

      const summary = await runDemoJobs(ctx, admin);
      expect(summary.claimed).toBeGreaterThan(0);

      const runs = await jobsRepo.listRuns(ctx);
      expect(runs.length).toBeGreaterThan(0);

      const run = runs[0] as NonNullable<(typeof runs)[number]>;
      expect(run.effectiveNow.getTime()).toBe(at.getTime());
      expect(run.realNow.getTime()).not.toBe(at.getTime());
      expect(run.triggeredBy).toBe("admin_button");
      // Whose clock it was. A demo payout has to be explainable from this row
      // alone, months later.
      expect(run.clockOverrideActorId).toBeTruthy();
    });

    it("names nobody's override when the timer ran it", async () => {
      // The real clock, which is the only thing the tick ever passes. The
      // seeded delivered order's auto-complete is genuinely due now.
      await runDueJobs(ctx, { asOf: new Date(), demoOnly: false, trigger: "cron" });

      const runs = await jobsRepo.listRuns(ctx);
      const run = runs[0] as NonNullable<(typeof runs)[number]>;
      expect(run.triggeredBy).toBe("cron");
      expect(run.clockOverrideActorId).toBeNull();
      // The same moment, to within the time the run took. Not the same
      // instant: the batch reads its as-of once and each job stamps the wall
      // clock as it finishes.
      expect(Math.abs(run.effectiveNow.getTime() - run.realNow.getTime())).toBeLessThan(60_000);
    });
  });

  describe("held and failed", () => {
    it("parks a payout for a vendor who may not be paid, rather than failing it", async () => {
      const order = await bookAndPayDeposit({ demo: true });
      await sql`
        update app.planning_org_vendors set status = 'suspended' where id = ${order.vendorId}
      `;

      await runDueJobs(ctx, { asOf: farFuture(), demoOnly: false, trigger: "cron" });

      const [job] = await sql<{ status: string; held_reason: string | null; attempts: number }[]>`
        select status::text, held_reason, attempts from app.planning_org_jobs
        where type = 'cooling_window_transfer' and payload ->> 'orderId' = ${order.id}
      `;

      expect(job?.status).toBe("held");
      // Not a failure, so it has not burned an attempt towards giving up on
      // money somebody is owed.
      expect(job?.attempts).toBe(0);
      expect(job?.held_reason).toBeTruthy();
    });

    it("backs a failing job off and keeps the rest of the queue moving", async () => {
      // A job whose order has vanished cannot succeed. The queue must not stop
      // at it.
      const order = await bookAndPayDeposit({ demo: true });
      await sql`
        update app.planning_org_jobs
        set payload = jsonb_build_object('orderId', gen_random_uuid())
        where type = 'charge_balance' and payload ->> 'orderId' = ${order.id}
      `;

      const summary = await runDueJobs(ctx, {
        asOf: farFuture(),
        demoOnly: false,
        trigger: "cron",
      });

      // Backing off, not failed: it will be tried again, and reporting it as a
      // failure sends somebody looking for a problem that is handling itself.
      expect(summary.retrying).toBeGreaterThan(0);
      expect(summary.failed).toBe(0);
      expect(summary.done).toBeGreaterThan(0);

      const [failed] = await sql<{ status: string; attempts: number; run_after: Date }[]>`
        select status::text, attempts, run_after from app.planning_org_jobs
        where type = 'charge_balance' and status = 'queued' and attempts > 0
        limit 1
      `;

      expect(failed?.attempts).toBe(1);
      expect((failed?.run_after as Date).getTime()).toBeGreaterThan(Date.now());
    });

    it("doubles the wait and stops at six hours", () => {
      expect(jobsRepo.backoffMs(1)).toBe(15 * 60_000);
      expect(jobsRepo.backoffMs(2)).toBe(30 * 60_000);
      expect(jobsRepo.backoffMs(3)).toBe(60 * 60_000);

      // The ceiling has to clamp a wait that actually happens, or it is a
      // comment rather than a rule. The last wait before a job is abandoned is
      // the sixth: it computes to 480 minutes and is clamped to 360.
      expect(jobsRepo.backoffMs(jobsRepo.MAX_ATTEMPTS - 1)).toBe(6 * 3_600_000);
      expect(jobsRepo.backoffMs(40)).toBe(6 * 3_600_000);
    });
  });

  describe("re-arming a job", () => {
    /** A job of a type nothing else in this suite runs, in a chosen state. */
    async function queueBare(status: string, runAfter: string): Promise<string> {
      const key = `expire_quote_request:${crypto.randomUUID()}`;
      await sql`
        insert into app.planning_org_jobs (type, dedupe_key, run_after, payload, status, is_demo)
        values (
          'expire_quote_request', ${key}, ${runAfter}::timestamptz,
          ${sql.json({ quoteRequestId: crypto.randomUUID() })}, ${status}::app.job_status, true
        )
      `;
      return key;
    }

    async function deadlineOf(dedupeKey: string): Promise<Date> {
      const [row] = await sql<{ run_after: Date }[]>`
        select run_after from app.planning_org_jobs where dedupe_key = ${dedupeKey}
      `;
      return row?.run_after as Date;
    }

    it("moves a queued job's deadline forward and reports it", async () => {
      const key = await queueBare("queued", new Date(Date.now() + 60_000).toISOString());
      const wanted = new Date(Date.now() + 3 * 3_600_000);

      const moved = await jobsRepo.rearmQueuedJob(ctx.db, {
        type: "expire_quote_request",
        dedupeKey: key,
        runAfter: wanted,
      });

      expect(moved?.getTime()).toBe(wanted.getTime());
      expect((await deadlineOf(key)).getTime()).toBe(wanted.getTime());
    });

    it("leaves a finished job and a parked one exactly where they are", async () => {
      // `done` is the status the dedupe key's guarantee rests on: a key that
      // could be re-armed would stop being one, and the replayed confirmation
      // it refuses would charge a second time.
      const at = new Date(Date.now() + 60_000).toISOString();

      for (const status of ["done", "held"]) {
        const key = await queueBare(status, at);
        const before = await deadlineOf(key);

        const moved = await jobsRepo.rearmQueuedJob(ctx.db, {
          type: "expire_quote_request",
          dedupeKey: key,
          runAfter: new Date(Date.now() + 3 * 3_600_000),
        });

        expect(moved).toBeUndefined();
        expect((await deadlineOf(key)).getTime()).toBe(before.getTime());
      }
    });

    it("never pulls a deadline backwards", async () => {
      // A re-arm asking for an earlier moment leaves the later one standing.
      // The alternative quietly brings a charge forward.
      const later = new Date(Date.now() + 6 * 3_600_000);
      const key = await queueBare("queued", later.toISOString());

      const moved = await jobsRepo.rearmQueuedJob(ctx.db, {
        type: "expire_quote_request",
        dedupeKey: key,
        runAfter: new Date(Date.now() + 60_000),
      });

      expect(moved?.getTime()).toBe(later.getTime());
      expect((await deadlineOf(key)).getTime()).toBe(later.getTime());
    });

    it("is not something enqueue can do", async () => {
      // The reason a separate statement exists. `enqueue`'s upsert only writes
      // over `held` and `failed`, so a live job conflicts, updates nothing and
      // answers false — silently, which is how a re-arm written through it
      // moves no deadline and reports no failure to.
      const later = new Date(Date.now() + 6 * 3_600_000);
      const key = await queueBare("queued", later.toISOString());

      const inserted = await jobsRepo.enqueue(ctx.db, {
        type: "expire_quote_request",
        dedupeKey: key,
        runAfter: new Date(Date.now() + 60_000),
        payload: {},
        isDemo: true,
      });

      expect(inserted).toBe(false);
      expect((await deadlineOf(key)).getTime()).toBe(later.getTime());
    });
  });

  describe("the soft hold expiring", () => {
    it("cancels the order and releases the date when the charge cancels", async () => {
      const { order } = await startCheckout({ demo: true });
      expect(await activeBlocks(order.id)).toBeGreaterThan(0);
      await makeOverdue(order.id, "expire_unpaid");

      await runDueJobs(ctx, { asOf: new Date(), demoOnly: false, trigger: "cron" });

      expect((await ordering.load(ctx.db, order.id))?.state).toBe("cancelled");
      expect(await activeBlocks(order.id)).toBe(0);
      expect((await jobStatus(order.id, "expire_unpaid"))?.status).toBe("done");
    });

    it("keeps the date when the provider refuses, and comes back to ask again", async () => {
      // The counter-intuitive row: the charge is going through, so the booking
      // is about to be real, and cancelling it would take the date away from
      // somebody whose card has been charged. The webhook has not arrived yet,
      // which is exactly the race.
      const { order, deposit } = await startCheckout({ demo: true });
      stripe.settleCheckoutSession(deposit.providerPaymentIntentId);

      const held = await activeBlocks(order.id);
      await makeOverdue(order.id, "expire_unpaid");

      const summary = await runDueJobs(ctx, { asOf: new Date(), demoOnly: false, trigger: "cron" });

      expect((await ordering.load(ctx.db, order.id))?.state).toBe("pending_payment");
      expect(await activeBlocks(order.id)).toBe(held);

      const job = await jobStatus(order.id, "expire_unpaid");
      expect(job?.status).toBe("queued");
      expect(job?.run_after.getTime()).toBeGreaterThan(Date.now());
      // Bounded, so a provider that never resolves cannot loop for ever.
      expect(job?.attempts).toBe(1);
      // And nothing went wrong, so nothing is recorded as having gone wrong.
      expect(job?.last_error).toBeNull();
      expect(summary.retrying).toBeGreaterThan(0);
      expect(summary.failed).toBe(0);
    });

    it("parks for a person once the attempts run out", async () => {
      const { order, deposit } = await startCheckout({ demo: true });
      stripe.settleCheckoutSession(deposit.providerPaymentIntentId);
      await makeOverdue(order.id, "expire_unpaid");
      await sql`
        update app.planning_org_jobs set attempts = ${jobsRepo.MAX_ATTEMPTS - 1}
        where type = 'expire_unpaid' and payload ->> 'orderId' = ${order.id}
      `;

      await runDueJobs(ctx, { asOf: new Date(), demoOnly: false, trigger: "cron" });

      const job = await jobStatus(order.id, "expire_unpaid");
      // `held`, not `failed`: waiting on a provider is not a fault, and an
      // operator reading a failure list should not have to work out that it
      // was never one.
      expect(job?.status).toBe("held");
      expect(job?.held_reason).toContain(order.reference);
      expect(job?.last_error).toBeNull();
      expect((await ordering.load(ctx.db, order.id))?.state).toBe("pending_payment");
    });

    it("releases the date anyway when the provider simply fails", async () => {
      // A stranded date is worse than an uncancelled charge: the charge expires
      // on the provider's own schedule, and a capture arriving afterwards is
      // refunded by the webhook.
      const { order } = await startCheckout({ demo: true });
      stripe.failNextWith("cancelPaymentIntent", new Error("The provider timed out."));
      await makeOverdue(order.id, "expire_unpaid");

      await runDueJobs(ctx, { asOf: new Date(), demoOnly: false, trigger: "cron" });

      expect((await ordering.load(ctx.db, order.id))?.state).toBe("cancelled");
      expect(await activeBlocks(order.id)).toBe(0);
      expect((await jobStatus(order.id, "expire_unpaid"))?.status).toBe("done");
    });
  });

  describe("the balance date the planner reads", () => {
    it("is the same instant on the order as on its queued charge", async () => {
      // The planner's payments panel states the next charge from
      // `orders.balance_due_at`, and the queue is what actually charges it.
      // Read off both tables in one join rather than compared to a date typed
      // into this file, so the seed moving cannot make this pass by agreeing
      // with nothing.
      const rows = await sql<{ reference: string; due: Date; run_after: Date }[]>`
        select o.reference, o.balance_due_at as due, j.run_after
        from app.planning_org_orders o
        join app.planning_org_jobs j
          on j.type = 'charge_balance' and j.payload ->> 'orderId' = o.id::text
        where j.status = 'queued' and o.balance_due_at is not null
      `;

      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect([row.reference, row.run_after.getTime()]).toEqual([
          row.reference,
          row.due.getTime(),
        ]);
      }
    });
  });

  describe("the lifecycle jobs", () => {
    it("releases the date when the grace window runs out", async () => {
      const order = await orderByReference("TO-4181");

      await runDueJobs(ctx, { asOf: farFuture(), demoOnly: false, trigger: "cron" });

      const after = await ordering.load(ctx.db, order.id);
      expect(after?.state).toBe("cancelled");
      expect(
        (await ordering.listCapacityBlocks(ctx.db, order.id)).filter((block) => block.active),
      ).toHaveLength(0);
    });

    it("completes a delivered order, and holds nothing when it was paid in full", async () => {
      // TO-4188 was paid in full at checkout, so its whole vendor share moved
      // at the cooling window and there is no second transfer to make. Asking
      // for one finds no settled balance charge and refuses — which would park
      // the job `held` for ever against an order that is finished and fully
      // paid out.
      await runDueJobs(ctx, { asOf: farFuture(), demoOnly: false, trigger: "cron" });

      const order = await orderByReference("TO-4188");
      expect((await ordering.load(ctx.db, order.id))?.state).toBe("completed");

      const [job] = await sql<{ status: string; held_reason: string | null }[]>`
        select status::text, held_reason from app.planning_org_jobs
        where type = 'auto_complete_order' and payload ->> 'orderId' = ${order.id}
      `;
      expect(job?.status).toBe("done");
      expect(job?.held_reason).toBeNull();
    });

    it("holds the balance share when the order has one and it cannot move", async () => {
      // The reachable `ValidationError` from a transfer: a balance the order
      // has, with no settled charge behind it. Held rather than failed — the
      // order is complete either way and this is a question for a person.
      const order = await bookAndPayDeposit({ demo: true });
      await sql`update app.planning_org_orders set state = 'fulfilled' where id = ${order.id}`;
      await sql`
        insert into app.planning_org_jobs (type, dedupe_key, run_after, payload, is_demo)
        values (
          'auto_complete_order',
          ${`auto_complete_order:${order.id}`},
          now() - interval '1 hour',
          ${sql.json({ orderId: order.id })},
          true
        )
        on conflict do nothing
      `;

      await runDueJobs(ctx, { asOf: new Date(), demoOnly: false, trigger: "cron" });

      const [job] = await sql<{ status: string; held_reason: string | null; attempts: number }[]>`
        select status::text, held_reason, attempts from app.planning_org_jobs
        where type = 'auto_complete_order' and payload ->> 'orderId' = ${order.id}
      `;
      expect(job?.status).toBe("held");
      expect(job?.attempts).toBe(0);
      expect((await ordering.load(ctx.db, order.id))?.state).toBe("completed");
    });

    it("pays a seeded order's deposit share, which is the demo's own moment", async () => {
      // The prototype's second clock state is exactly this: "1 job due:
      // transfer the deposit share to the vendor" (line 2156). It could not
      // happen until the seed wrote a charge id — a transfer draws on a charge,
      // not on an intent — and the job parked as held against every demo order.
      const order = await orderByReference("TO-4192");

      await runDueJobs(ctx, {
        asOf: new Date(Date.now() + 72 * 3_600_000),
        demoOnly: true,
        trigger: "admin_button",
      });

      const transfer = await payments.loadTransfer(ctx.db, order.id, "deposit_share");
      expect(transfer?.state).toBe("paid");
      expect(transfer?.providerTransferId).toBeTruthy();

      const [job] = await sql<{ status: string }[]>`
        select status::text from app.planning_org_jobs
        where type = 'cooling_window_transfer' and payload ->> 'orderId' = ${order.id}
      `;
      expect(job?.status).toBe("done");
    });

    it("releases a hold nobody paid for", async () => {
      const [event] = await sql<{ id: string }[]>`
        insert into app.planning_org_events (owner_user_id, name, event_date, start_time, timezone)
        values (
          (select id from app.planning_org_users where email = 'sarah@example.ca'),
          'Abandoned', (now() + interval '90 days')::date, '17:00', 'America/Toronto'
        ) returning id
      `;
      const [service] = await sql<{ id: string }[]>`
        select s.id from app.planning_org_services s
        join app.planning_org_vendors v on v.id = s.vendor_id
        where v.slug = 'bloom-and-co' and v.status = 'approved' limit 1
      `;

      const checkout = await createCheckout(ctx, customer, {
        eventId: event?.id as string,
        lines: [{ serviceId: service?.id as string, quantity: 1 }],
      });
      const order = checkout.orders[0] as NonNullable<(typeof checkout.orders)[number]>;

      await runDueJobs(ctx, {
        asOf: new Date(Date.now() + 31 * 60_000),
        demoOnly: false,
        trigger: "cron",
      });

      expect((await ordering.load(ctx.db, order.id))?.state).toBe("cancelled");
      expect(
        (await ordering.listCapacityBlocks(ctx.db, order.id)).filter((block) => block.active),
      ).toHaveLength(0);
    });
  });

  describe("the override", () => {
    it("is stored, read back and lapses on its own", async () => {
      const at = farFuture();
      const stored = await setOverride(ctx, admin, at);

      expect(stored.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(
        OVERRIDE_TTL_MINUTES * 60_000 + 1_000,
      );

      const read = await readOverride(ctx, stored.actorUserId);
      expect(read?.effectiveAt.getTime()).toBe(at.getTime());

      // Expired reads as absent rather than being deleted by a read.
      await sql`
        update app.planning_org_platform_settings
        set value = jsonb_set(value, '{expiresAt}', to_jsonb((now() - interval '1 hour')::text))
        where key like 'clock_override:%'
      `;
      expect(await readOverride(ctx, stored.actorUserId)).toBeNull();
    });

    it("is refused outright on a production tier", async () => {
      const production = productionContext();

      await expect(setOverride(production, admin, farFuture())).rejects.toThrow(ValidationError);
      await expect(runDemoJobs(production, admin)).rejects.toThrow(ValidationError);
    });

    it("clears only its own keys, never the platform's rates", async () => {
      await setOverride(ctx, admin, farFuture());
      const before = await settingKeys();
      expect(before.some((key) => key.startsWith("clock_override:"))).toBe(true);

      await clearAllOverrides(ctx);
      const after = await settingKeys();

      expect(after.some((key) => key.startsWith("clock_override:"))).toBe(false);
      // The commission and tax rates live in the same table. A reseed that took
      // them with the demo data would take the platform's economics.
      expect(after.length).toBe(before.length - 1);
      expect(after.length).toBeGreaterThan(0);
    });

    it("changes what the queue lists without running anything", async () => {
      const before = await getOpsView(ctx, admin);
      await setOverride(ctx, admin, farFuture());
      const after = await getOpsView(ctx, admin);

      expect(after.dueNow).toBeGreaterThan(before.dueNow);
      expect(after.runs).toHaveLength(0);
      expect(
        (
          await sql<
            { total: number }[]
          >`select count(*)::int as total from app.planning_org_job_runs`
        )[0]?.total,
      ).toBe(0);
    });
  });

  describe("the demo clock states", () => {
    it("are computed from the seed's anchor, not written down", async () => {
      const states = await demoClockStates(ctx);
      const rows = await sql<{ anchor_at: Date }[]>`
        select anchor_at from app.planning_org_seed_meta limit 1
      `;
      const anchor = rows[0]?.anchor_at as Date;

      expect(states.map((state) => state.key)).toEqual([
        "now",
        "cooling_window",
        "balance_due",
        "auto_complete",
      ]);
      expect(states[0]?.at.getTime()).toBe(anchor.getTime());
      expect((states[1]?.at.getTime() ?? 0) - anchor.getTime()).toBe(48 * 3_600_000);
      // The third is whenever the first balance actually falls due, which is a
      // fact about somebody's event rather than about the anchor.
      expect(states[2]?.at.getTime()).toBeGreaterThan(anchor.getTime());
      expect(states[3]?.at.getTime()).toBeGreaterThan(states[2]?.at.getTime() ?? 0);
    });
  });

  describe("recovery", () => {
    it("reclaims a job whose runner never came back", async () => {
      // No lease, no recovery: a tick killed mid-batch — a deploy, an
      // out-of-memory kill, a function timeout — leaves its jobs `running` and
      // nothing ever looks at them again. A balance never collected, a vendor
      // never paid, and no error anywhere.
      await sql`
        update app.planning_org_jobs
        set status = 'running', updated_at = now() - interval '2 hours'
      `;

      const summary = await runDueJobs(ctx, {
        asOf: farFuture(),
        demoOnly: false,
        trigger: "cron",
      });

      expect(summary.claimed).toBeGreaterThan(0);
    });

    it("leaves a job that was claimed a moment ago alone", async () => {
      await sql`update app.planning_org_jobs set status = 'running', updated_at = now()`;

      const summary = await runDueJobs(ctx, {
        asOf: farFuture(),
        demoOnly: false,
        trigger: "cron",
      });

      expect(summary.claimed).toBe(0);
    });

    it("wakes a parked job when the lifecycle asks for it again", async () => {
      // An order delivered, flagged, and resolved back to delivered. The
      // auto-complete job comes due while it is flagged, parks, and the
      // re-entry has to wake it — otherwise the order never completes and the
      // balance share, the larger half of the vendor's money, never moves.
      const order = await bookAndPayDeposit({ demo: true });
      await markFulfilled(ctx, admin, order.id);
      await raiseIssue(ctx, admin, order.id, "The flowers were late.");

      await runDueJobs(ctx, { asOf: farFuture(), demoOnly: false, trigger: "cron" });

      const parked = await jobStatus(order.id, "auto_complete_order");
      expect(parked?.status).toBe("held");

      await resolveIssue(ctx, admin, order.id, "fulfilled", "Replaced the same afternoon.");

      const rearmed = await jobStatus(order.id, "auto_complete_order");
      expect(rearmed?.status).toBe("queued");
      expect(rearmed?.held_reason).toBeNull();

      await runDueJobs(ctx, { asOf: farFuture(), demoOnly: false, trigger: "cron" });
      expect((await ordering.load(ctx.db, order.id))?.state).toBe("completed");
    });

    it("holds a balance charge on a flagged order rather than burning it", async () => {
      // `charge_balance` is enqueued once, when an order is first confirmed,
      // and nothing re-enqueues it. A flagged order that failed its way to
      // `failed` would therefore never be charged at all — not even after the
      // issue was resolved and the booking went ahead.
      const order = await bookAndPayDeposit({ demo: true });
      await raiseIssue(ctx, admin, order.id, "Something to look at.");

      await runDueJobs(ctx, { asOf: farFuture(), demoOnly: false, trigger: "cron" });

      const parked = await jobStatus(order.id, "charge_balance");
      expect(parked?.status).toBe("held");
      expect(parked?.attempts).toBe(0);
    });
  });

  describe("the demo clock states, under retry", () => {
    it("label the balance moment with the offset its own rows have", async () => {
      // How far ahead of the event a balance is charged is a platform setting,
      // and this row was written under whatever it was when the order was
      // confirmed. So neither a number written into the label nor today's
      // setting describes the button: only the gap between the two instants
      // does, which is what the label is computed from.
      //
      // Cross-checked against the database's own date arithmetic in the event's
      // zone, so this is two implementations agreeing rather than the code
      // being read back to itself.
      const gapInDays = async () => {
        const [row] = await sql<{ days: number }[]>`
          select (e.event_date - (o.balance_due_at at time zone e.timezone)::date)::int as days
          from app.planning_org_orders o
          join app.planning_org_events e on e.id = o.event_id
          where o.balance_due_at is not null
            and o.balance_amount > 0
            and o.state in ('confirmed', 'balance_due', 'action_required')
          order by o.balance_due_at asc limit 1
        `;
        return row?.days as number;
      };

      const labelled = (states: Awaited<ReturnType<typeof demoClockStates>>) =>
        states.find((state) => state.key === "balance_due")?.name;

      const seeded = await gapInDays();
      expect(labelled(await demoClockStates(ctx))).toBe(`event−${seeded}d`);

      // And it follows the data rather than restating a constant: move the due
      // date and the claim moves with it.
      await sql`
        update app.planning_org_orders
        set balance_due_at = balance_due_at - interval '7 days'
        where balance_due_at is not null and balance_amount > 0
      `;

      const moved = await gapInDays();
      expect(moved).not.toBe(seeded);
      expect(labelled(await demoClockStates(ctx))).toBe(`event−${moved}d`);
    });

    it("do not collapse to this afternoon when a charge bounces", async () => {
      // Derived from the order's own due date, not from its job's `run_after`.
      // A failed charge is re-queued minutes from now, and a state read off the
      // job would relabel the demo's "event−14d" moment as today — because a
      // card bounced.
      const before = await demoClockStates(ctx);
      const balanceDue = before.find((state) => state.key === "balance_due");

      await sql`
        update app.planning_org_jobs
        set run_after = now(), attempts = 1
        where type = 'charge_balance'
      `;

      const after = await demoClockStates(ctx);
      expect(after.find((state) => state.key === "balance_due")?.at.getTime()).toBe(
        balanceDue?.at.getTime(),
      );
    });
  });

  describe("reseeding", () => {
    it("refuses without the deployment typed, and says which word", async () => {
      const blockers = await reseedBlockers(ctx, admin, "");
      expect(blockers.map((blocker) => blocker.code)).toContain("confirmation");
      expect(blockers.find((blocker) => blocker.code === "confirmation")?.message).toContain(
        "local",
      );

      expect(await reseedBlockers(ctx, admin, "local")).toHaveLength(0);
    });

    it("refuses while a job is running", async () => {
      await sql`update app.planning_org_jobs set status = 'running' where true`;

      const blockers = await reseedBlockers(ctx, admin, "local");
      expect(blockers.map((blocker) => blocker.code)).toContain("running");
    });

    it("refuses while a charge has no outcome yet", async () => {
      const order = await orderByReference("TO-4192");
      await payments.openPayment(ctx.db, {
        orderId: order.id,
        kind: "balance",
        amount: 100n,
        currency: "CAD",
        offSession: true,
        now: new Date(),
      });

      const blockers = await reseedBlockers(ctx, admin, "local");
      expect(blockers.map((blocker) => blocker.code)).toContain("pending_payment");
    });

    it.each([
      ["a demo business", "vendor_id", "app.planning_org_vendors"],
      ["a demo account", "user_id", "app.planning_org_users"],
    ])("refuses when a real booking is attached to %s", async (_what, column) => {
      // The reseed's contract is that it deletes demo rows and leaves
      // everything else standing, and with a real order on a demo row it
      // cannot: the row is on the list, the order is not, and the delete dies
      // on a foreign key several layers below the button.
      //
      // Both sides, because a tier that cannot move its clock writes a real
      // order against whichever rows it names — so an operator booking
      // something on a live deployment against a seeded business produces the
      // vendor-side case, and a seeded account produces the other.
      const order = await orderByReference("TO-4192");
      await sql`update app.planning_org_orders set is_demo = false where id = ${order.id}`;
      // Only the side under test is demo, so a pass cannot come from the other.
      await sql`
        update app.planning_org_vendors set is_demo = ${column === "vendor_id"}
        where id = ${order.vendorId}
      `;
      await sql`
        update app.planning_org_users set is_demo = ${column === "user_id"}
        where id = ${order.userId}
      `;

      const blockers = await reseedBlockers(ctx, admin, "local");
      const blocker = blockers.find((one) => one.code === "real_orders_on_demo_rows");

      expect(blocker).toBeDefined();
      expect(blocker?.message).toContain("1 order");
    });

    it("is refused outright on a production tier", async () => {
      const blockers = await reseedBlockers(productionContext(), admin, "production");
      expect(blockers.map((blocker) => blocker.code)).toContain("tier");
    });
  });

  describe("parked webhooks", () => {
    it("applies an event that arrived before its order existed", async () => {
      // The route parks an event whose order is not written yet, with no error,
      // because nothing is wrong. Until this sweep existed nothing ever came
      // back for one — an order paid for and never confirmed.
      const order = await bookAndPayDeposit({ demo: true });
      const deposit = await payments.succeededPaymentOfKind(ctx.db, order.id, "deposit");

      // Put the order back to unpaid and park its confirmation, which is the
      // shape of the race: the event is on disk, the order is not confirmed.
      await sql`
        update app.planning_org_orders set state = 'pending_payment' where id = ${order.id}
      `;
      await sql`
        insert into app.planning_org_stripe_events (event_id, type, payload, received_at)
        values (
          'evt_test_parked',
          'payment_intent.succeeded',
          ${sql.json({
            data: {
              object: {
                id: deposit?.providerPaymentIntentId,
                metadata: { order_id: order.id, payment_id: deposit?.id },
              },
            },
          })},
          now()
        )
      `;

      const sweep = await sweepParkedWebhooks(ctx);
      expect(sweep.applied).toBe(1);
      expect((await ordering.load(ctx.db, order.id))?.state).toBe("confirmed");

      // And a second sweep finds nothing, because `processed_at` is set.
      expect((await sweepParkedWebhooks(ctx)).applied).toBe(0);
    });
  });

  describe("the system principal", () => {
    it("is never what a request resolves to", async () => {
      // It passes the order policies, so the first thing that must stay true is
      // that no sign-in can produce it.
      expect(admin.kind).toBe("user");
      expect(customer.kind).toBe("user");

      database.setUser(null);
      expect((await getActor(ctx)).kind).toBe("anonymous");
      expect(SYSTEM.kind).toBe("system");
    });

    it("passes the three order policies and nothing else", async () => {
      const order = await orderByReference("TO-4192");
      const parties = { id: order.id, userId: order.userId, vendorId: order.vendorId };

      // What the runner needs.
      expect(() => assertCanReadOrder(SYSTEM, parties)).not.toThrow();
      expect(() => assertCanActOnOrder(SYSTEM, parties)).not.toThrow();
      expect(() => assertCanPayOrder(SYSTEM, parties)).not.toThrow();

      // And nothing it does not. These are the boundary of the widening: a
      // principal that could approve a vendor or act on an account would be a
      // way around the second authorization layer entirely.
      expect(() => assertCanActOnVendor(SYSTEM, { id: order.vendorId })).toThrow(NotFoundError);
      expect(() => assertCanReadVendorPrivately(SYSTEM, { id: order.vendorId })).toThrow(
        NotFoundError,
      );
      expect(() => assertCanActOnUser(SYSTEM, { id: order.userId })).toThrow(NotFoundError);
      expect(() => assertCanReadUser(SYSTEM, { id: order.userId })).toThrow(NotFoundError);
      expect(() => assertCanReadEvent(SYSTEM, { id: "e", ownerUserId: order.userId })).toThrow(
        NotFoundError,
      );

      // It is not an administrator, and it is not a person.
      expect(() => requireAdmin(SYSTEM)).toThrow();
      expect(isAuthenticated(SYSTEM)).toBe(false);
      expect(isUsable(SYSTEM)).toBe(false);
    });
  });

  async function settingKeys(): Promise<string[]> {
    const rows = await sql<{ key: string }[]>`select key from app.planning_org_platform_settings`;
    return rows.map((row) => row.key);
  }

  /** The same database, described as a production deployment. */
  function productionContext(): CoreContext {
    return createCoreContext({
      ...ctx,
      config: {
        ...ctx.config,
        appTier: "production",
        allowClockOverride: false,
        allowDestructiveSeed: false,
      },
    });
  }
});
