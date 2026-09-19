import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql as raw, type SQL } from "drizzle-orm";
import type postgres from "postgres";
import type { CoreContext } from "../src/context.js";
import type { Actor } from "../src/identity/actor.js";
import { getActor } from "../src/identity/service.js";
import {
  grantRoleToUser,
  revokeRoleFromUser,
  suspendAccount,
} from "../src/identity/admin-service.js";
import { inviteAdmin } from "../src/identity/invites.js";
import { suspendVendor } from "../src/vendors/service.js";
import {
  markOrderFulfilled,
  recordDashboardRefund,
  refundCoolingWindow,
  retryBalance,
} from "../src/ordering/admin-service.js";
import { requeueJob, setClockOverride } from "../src/jobs/admin-service.js";
import { runDueJobs } from "../src/jobs/runner.js";
import { sendTest } from "../src/email/service.js";
import { sweepParkedWebhooks } from "../src/payments/service.js";
import * as paymentsRepo from "../src/payments/repo.js";
import { createStripeFake, type StripeFake } from "../src/testing/stripe-fake.js";
import { createDatabaseContext, ownerSql, resetDatabase, testDatabaseUrl } from "./harness.js";

/**
 * What happens when something goes wrong twice.
 *
 * The lifecycle tests ask whether the platform does the right thing. These ask
 * what it does when the provider is down, when a handler throws halfway, and
 * when somebody presses a button twice — which is not an edge case but the
 * ordinary behaviour of a slow page, and the one case where the cost of getting
 * it wrong is a second charge on a real card.
 *
 * The double-submit cases are written as a count rather than as an error,
 * deliberately. "The second press is refused" and "the second press is a no-op"
 * are both acceptable answers and different actions give different ones; what
 * is never acceptable is a second effect. So each case names the rows that must
 * not multiply, runs the action once, runs it twice, and compares.
 */

/**
 * Thrown to unwind a transaction once its assertions have been read.
 *
 * A real `Error` rather than a symbol, so it travels through anything that only
 * rethrows errors — including the domain's own transaction wrappers.
 */
class Rollback extends Error {
  constructor() {
    super("rollback");
    this.name = "Rollback";
  }
}

const url = testDatabaseUrl();

describe.skipIf(!url)("resilience", () => {
  const dbUrl = url as string;
  let sql: postgres.Sql;
  let database: ReturnType<typeof createDatabaseContext>;
  let ctx: CoreContext;
  let stripe: StripeFake;
  let admin: Actor;

  let confirmedOrderId: string;
  let actionRequiredOrderId: string;
  let activeUserId: string;
  let approvedVendorId: string;
  let heldJobId: string;

  beforeAll(async () => {
    await resetDatabase(dbUrl);
    sql = ownerSql(dbUrl);
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

    database.setUser({
      id: "provider-sub-admin@occasion.test",
      email: "admin@occasion.test",
      issuedAt: new Date(),
      emailVerified: true,
      secondFactorVerified: true,
    });
    admin = await getActor(ctx, {});

    const one = async (query: postgres.PendingQuery<{ id: string }[]>) => {
      const [row] = await query;
      return row?.id as string;
    };

    confirmedOrderId = await one(
      sql`select id from app.planning_org_orders where reference = 'TO-4192'`,
    );
    actionRequiredOrderId = await one(
      sql`select id from app.planning_org_orders where state = 'action_required' limit 1`,
    );
    activeUserId = await one(
      sql`select id from app.planning_org_users where email = 'sarah@example.ca'`,
    );
    approvedVendorId = await one(
      sql`select id from app.planning_org_vendors where slug = 'bloom-and-co'`,
    );
    // A named type, not whichever row comes back first. Parking the transfer or
    // the balance charge by accident would take it out of the queue that the
    // provider-outage case below is about, and that case would then pass by
    // running nothing at all.
    heldJobId = await one(sql`
      update app.planning_org_jobs
      set status = 'held', held_reason = 'vendor suspended'
      where id = (
        select id from app.planning_org_jobs
        where type = 'expire_quote_request' order by id limit 1
      )
      returning id
    `);

    for (const [name, value] of Object.entries({
      confirmedOrderId,
      actionRequiredOrderId,
      activeUserId,
      approvedVendorId,
      heldJobId,
    })) {
      if (!value) throw new Error(`resilience fixture did not resolve ${name}`);
    }
  }, 180_000);

  afterAll(async () => {
    await database?.close();
    await sql?.end({ timeout: 5 });
  });

  /**
   * Runs `work` in a transaction that is rolled back, and reports the count.
   *
   * Errors from the work itself are swallowed: a refusal is one of the two
   * acceptable answers to a second press, and the assertion is about what the
   * database holds afterwards rather than about what was thrown.
   */
  async function countAfter(
    presses: number,
    work: (ctx: CoreContext) => Promise<unknown>,
    count: (ctx: CoreContext) => Promise<number>,
  ): Promise<number> {
    const rollback = new Rollback();
    let total = 0;

    try {
      await ctx.db.transaction(async (tx) => {
        const scoped = { ...ctx, db: tx as unknown as CoreContext["db"] };
        for (let press = 0; press < presses; press += 1) {
          try {
            await work(scoped);
          } catch {
            // Refusing the second press is a correct answer.
          }
        }
        total = await count(scoped);
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }

    return total;
  }

  type Press = {
    what: string;
    /** The rows that must not multiply, and the sentence explaining why. */
    because: string;
    work: (ctx: CoreContext) => Promise<unknown>;
    count: (ctx: CoreContext) => Promise<number>;
  };

  /** One number, read through whichever handle the caller is holding. */
  async function rows(ctx: CoreContext, query: SQL): Promise<number> {
    const result = (await ctx.db.execute(query)) as unknown as Array<{ count: number }>;
    return Number(result[0]?.count ?? 0);
  }

  it("is wired to a real database", async () => {
    expect(confirmedOrderId).toBeDefined();
    expect(
      await rows(ctx, raw`select count(*)::int as count from app.planning_org_orders`),
    ).toBeGreaterThan(0);
  });

  const PRESSES: readonly Press[] = [
    {
      what: "refunding inside the cooling window",
      because: "A second refund is a second movement of real money.",
      work: (c) => refundCoolingWindow(c, admin, confirmedOrderId),
      count: (c) =>
        rows(
          c,
          raw`select count(*)::int as count from app.planning_org_refunds where order_id = ${confirmedOrderId}`,
        ),
    },
    {
      what: "recording the same dashboard refund",
      because:
        "The provider's refund id is the fact being recorded; recording it twice double-counts money that moved once.",
      work: (c) =>
        recordDashboardRefund(c, admin, confirmedOrderId, {
          providerRefundId: "reDoubleSubmit",
          amount: 500n,
          reason: "goodwill",
        }),
      count: (c) =>
        rows(
          c,
          raw`select count(*)::int as count from app.planning_org_refunds where order_id = ${confirmedOrderId}`,
        ),
    },
    {
      what: "granting a role",
      because: "Two rows for one role is a revoke that only removes half of it.",
      work: (c) => grantRoleToUser(c, admin, activeUserId, "vendor", undefined),
      count: (c) =>
        rows(
          c,
          raw`select count(*)::int as count from app.planning_org_user_roles where user_id = ${activeUserId}`,
        ),
    },
    {
      what: "revoking a role",
      because: "The second press must not take a role the first press did not.",
      work: (c) => revokeRoleFromUser(c, admin, activeUserId, "customer"),
      count: (c) =>
        rows(
          c,
          raw`select count(*)::int as count from app.planning_org_user_roles where user_id = ${activeUserId}`,
        ),
    },
    {
      what: "inviting the same administrator",
      because:
        "Two live invitations to one address are two tokens, and revoking the one somebody remembers leaves the other working.",
      work: (c) => inviteAdmin(c, admin, "double@occasion.test"),
      count: (c) =>
        rows(
          c,
          raw`select count(*)::int as count from app.planning_org_admin_invites where email = ${"double@occasion.test"} and revoked_at is null and accepted_at is null`,
        ),
    },
    {
      what: "suspending a vendor",
      because: "Suspending twice must not park the same transfer twice.",
      work: (c) => suspendVendor(c, admin, approvedVendorId, "chargebacks"),
      count: (c) =>
        rows(
          c,
          raw`select count(*)::int as count from app.planning_org_audit_log where action = 'vendor.suspend' and entity_id = ${approvedVendorId}`,
        ),
    },
    {
      what: "suspending an account",
      because: "The log should say an account was suspended once, because it was.",
      work: (c) => suspendAccount(c, admin, activeUserId, "abuse"),
      count: (c) =>
        rows(
          c,
          raw`select count(*)::int as count from app.planning_org_audit_log where action = 'identity.user.suspend' and entity_id = ${activeUserId}`,
        ),
    },
    {
      what: "marking an order fulfilled",
      because: "The second press must not queue a second auto-completion.",
      work: (c) => markOrderFulfilled(c, admin, confirmedOrderId),
      count: (c) =>
        rows(
          c,
          raw`select count(*)::int as count from app.planning_org_jobs where type = 'auto_complete_order' and payload ->> 'orderId' = ${confirmedOrderId}`,
        ),
    },
    {
      what: "re-queueing a parked job",
      because: "Re-queueing twice must not reset the attempt count of a job already running.",
      work: (c) => requeueJob(c, admin, heldJobId),
      count: (c) =>
        rows(
          c,
          raw`select count(*)::int as count from app.planning_org_audit_log where action = 'ops.job.requeue' and entity_id = ${heldJobId}`,
        ),
    },
    {
      what: "moving the demo clock",
      because: "One administrator has one override, not a pile of them.",
      work: (c) => setClockOverride(c, admin, new Date(Date.now() + 86_400_000)),
      count: (c) =>
        rows(
          c,
          raw`select count(*)::int as count from app.planning_org_platform_settings where key like ${"clock_override%"}`,
        ),
    },
    {
      what: "sending a test to myself",
      because: "One press, one message.",
      work: (c) => sendTest(c, admin, "vendor_approved"),
      count: (c) =>
        rows(
          c,
          raw`select count(*)::int as count from app.planning_org_jobs where type = 'send_email'`,
        ),
    },
    {
      what: "retrying a declined balance",
      because:
        "Each press mints a single-use link that can be paid. Two live links for one balance are two ways to pay it.",
      work: (c) => retryBalance(c, admin, actionRequiredOrderId),
      // `clock_timestamp()` rather than `now()`. Postgres reads `now()` as the
      // instant the transaction began, and both presses happen inside one, so a
      // link superseded a millisecond ago would still come back as live.
      count: (c) =>
        rows(
          c,
          raw`select count(*)::int as count from app.planning_org_payment_links
              where order_id = ${actionRequiredOrderId}
                and consumed_at is null
                and expires_at > clock_timestamp()`,
        ),
    },
  ];

  describe.each(PRESSES)("pressing $what twice", (press) => {
    it(`has the same effect as pressing it once — ${press.because}`, async () => {
      const once = await countAfter(1, press.work, press.count);
      const twice = await countAfter(2, press.work, press.count);

      expect(twice).toBe(once);
    });
  });

  describe("a replacement payment link", () => {
    it("retires the one it replaces on the clock liveness is judged on", async () => {
      // The retirement and the liveness check have to read the same clock. Held
      // apart — retiring on the wall clock while `paymentLinkState` reads the
      // domain clock — an override sitting *behind* real time leaves a prior
      // link that this statement treats as already expired and the payment page
      // treats as payable. Two live bearer tokens for one balance.
      //
      // The override is set behind real time here because that is the direction
      // that used to be wrong; ahead of it, retiring early is the safe error.
      const behind = new Date(Date.now() - 6 * 3_600_000);
      database.setDomainNow(behind);

      try {
        await retryBalance(ctx, admin, actionRequiredOrderId);
        await retryBalance(ctx, admin, actionRequiredOrderId);

        const live = await sql<{ count: number }[]>`
          select count(*)::int as count from app.planning_org_payment_links
          where order_id = ${actionRequiredOrderId}
            and consumed_at is null
            and expires_at > ${behind}
        `;

        expect(live[0]?.count).toBe(1);
      } finally {
        database.setDomainNow(null);
      }
    }, 60_000);
  });

  describe("the provider is down", () => {
    it("keeps the payout queued, and pays it once when the provider comes back", async () => {
      // The prototype's own moment: TO-4192's cooling window closes and the
      // deposit share becomes payable. Here the provider is unreachable when
      // the job runs. The fake raises *after* recording the object, which is
      // the case a naive retry gets wrong — it is why "did the transfer
      // happen?" cannot be answered by whether the call threw.
      const [order] = await sql<{ id: string }[]>`
        select id from app.planning_org_orders where reference = 'TO-4192'
      `;
      const orderId = order?.id as string;
      const asOf = new Date(Date.now() + 72 * 3_600_000);

      stripe.failNextWith("createTransfer", new Error("Stripe is unreachable."));
      const failed = await runDueJobs(ctx, { asOf, demoOnly: true, trigger: "admin_button" });

      expect(failed.claimed).toBeGreaterThan(0);
      // Not done, and not failed. An outage is not the job's fault, so the
      // queue either backs it off or parks it; what it must not do is mark the
      // work finished or abandon it.
      expect(failed.retrying + failed.held).toBeGreaterThan(0);
      expect(failed.failed).toBe(0);

      const [duringOutage] = await sql<{ count: number }[]>`
        select count(*)::int as count from app.planning_org_transfers
        where order_id = ${orderId} and kind = 'deposit_share' and state = 'paid'
      `;
      expect(duringOutage?.count).toBe(0);

      // The provider is back. Only the backed-off job is brought forward:
      // releasing the whole queue would pull a balance charge and a grace
      // expiry months early, and the transfer would then be held for a reason
      // this case never meant to create.
      await sql`
        update app.planning_org_jobs set run_after = now()
        where type = 'cooling_window_transfer' and status = 'queued'
      `;
      await runDueJobs(ctx, { asOf, demoOnly: true, trigger: "admin_button" });
      await runDueJobs(ctx, { asOf, demoOnly: true, trigger: "admin_button" });

      const [afterRetry] = await sql<{ count: number }[]>`
        select count(*)::int as count from app.planning_org_transfers
        where order_id = ${orderId} and kind = 'deposit_share' and state = 'paid'
      `;
      expect(afterRetry?.count).toBe(1);
    }, 120_000);
  });

  describe("a webhook the handler could not finish", () => {
    it("is kept, retried, and applied once", async () => {
      // Stripe retries a 5xx, and the route answers 5xx by design so that it
      // does. What must not happen is the event being lost, or being applied
      // twice when the retry lands after the first attempt half-succeeded.
      const eventId = `evt_resilience_${Date.now()}`;
      await paymentsRepo.recordWebhook(ctx.db, {
        eventId,
        type: "payment_intent.succeeded",
        account: null,
        payload: { id: "pi_nonexistent_resilience" },
        now: new Date(),
      });
      await sql`
        update app.planning_org_stripe_events
        set processed_at = null, last_error = 'handler threw'
        where event_id = ${eventId}
      `;

      const unprocessed = await paymentsRepo.listUnprocessedWebhooks(ctx.db, 50);
      expect(unprocessed.some((row) => row.eventId === eventId)).toBe(true);

      await sweepParkedWebhooks(ctx, 50);
      await sweepParkedWebhooks(ctx, 50);

      const [row] = await sql<{ count: number; attempts: number }[]>`
        select count(*)::int as count, max(attempts)::int as attempts
        from app.planning_org_stripe_events where event_id = ${eventId}
      `;

      // Stored once whatever the sweep does with it: the event id is the key,
      // and a redelivery of the same event is the same row.
      expect(row?.count).toBe(1);

      // And it was genuinely retried rather than left alone — two sweeps, two
      // attempts. Without this the case passes on a sweep that never looked at
      // it, which is what "kept, retried and applied once" has to rule out.
      expect(row?.attempts).toBeGreaterThanOrEqual(2);

      // The event names an intent that does not exist, so it can never apply.
      // What matters is that trying did not invent an order for it.
      const [orders] = await sql<{ count: number }[]>`
        select count(*)::int as count from app.planning_org_payments
        where provider_payment_intent_id = 'pi_nonexistent_resilience'
      `;
      expect(orders?.count).toBe(0);
    }, 60_000);
  });

  describe("a job whose handler cannot finish", () => {
    it("leaves the order where it was, and comes back to it", async () => {
      // The stand-in for losing the database mid-job, and the claim is narrower
      // than it first looks. The attempt row deliberately *survives* a provider
      // failure — it is written before the call precisely so a timeout leaves
      // evidence that money may have moved. What must not survive is any
      // movement of the order itself.
      //
      // The failure has to be one the domain has no opinion about. An earlier
      // version of this armed the off-session charge, which is a *declined
      // card* — a business outcome the handler records and completes normally —
      // so the job finished, correctly, and the case asserted nothing.
      // Resolving the customer is the step before any of that, and a provider
      // that cannot answer it is an outage rather than an answer.
      //
      // Scoped to one job rather than to the whole queue: claiming everything
      // due in a year and then asserting about one order would pass on the
      // strength of jobs this case is not about. Everything else is parked
      // first, so the armed failure can only land on the balance charge.
      const [order] = await sql<{ id: string; balance: string }[]>`
        select id, balance_amount::text as balance from app.planning_org_orders
        where reference = 'TO-4207'
      `;
      const orderId = order?.id as string;

      await sql`
        update app.planning_org_jobs set status = 'held', held_reason = 'parked by this test'
        where status = 'queued'
          and not (type = 'charge_balance' and payload ->> 'orderId' = ${orderId})
      `;
      const [target] = await sql<{ id: string; state: string }[]>`
        select id, state::text from app.planning_org_orders where id = ${orderId}
      `;
      const [charged] = await sql<{ count: number }[]>`
        select count(*)::int as count from app.planning_org_payments
        where order_id = ${orderId} and state = 'succeeded'
      `;

      stripe.failNextWith("ensureCustomer", new Error("connection reset"));
      const summary = await runDueJobs(ctx, {
        asOf: new Date(Date.now() + 365 * 86_400_000),
        demoOnly: false,
        trigger: "cron",
      });

      // Exactly the one job, and it did not finish.
      expect(summary.claimed).toBe(1);
      expect(summary.done, JSON.stringify(summary.results)).toBe(0);
      expect(summary.failed).toBe(0);
      expect(summary.retrying + summary.held).toBe(1);

      const [after] = await sql<{ state: string }[]>`
        select state::text from app.planning_org_orders where id = ${orderId}
      `;
      const [succeeded] = await sql<{ count: number }[]>`
        select count(*)::int as count from app.planning_org_payments
        where order_id = ${orderId} and state = 'succeeded'
      `;
      const [balance] = await sql<{ balance: string }[]>`
        select balance_amount::text as balance from app.planning_org_orders where id = ${orderId}
      `;

      // The order did not move, no charge is recorded as settled, and the
      // balance still stands. A handler that half-applied its work fails at
      // least one of these three.
      expect(after?.state).toBe(target?.state);
      expect(succeeded?.count).toBe(charged?.count);
      expect(balance?.balance).toBe(order?.balance);
    }, 120_000);
  });
});
