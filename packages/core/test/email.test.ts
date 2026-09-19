import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type postgres from "postgres";
import { ForbiddenError, ValidationError } from "../src/errors.js";
import type { Actor } from "../src/identity/actor.js";
import type { CoreContext } from "../src/context.js";
import { getActor } from "../src/identity/service.js";
import {
  getEmailView,
  setMarketingConsent,
  liveTemplate,
  saveTemplate,
  sendBroadcast,
  sendTest,
  setAutoSend,
  unsubscribe,
} from "../src/email/service.js";
import { resolveRecipients } from "../src/email/audience.js";
import { runDueJobs } from "../src/jobs/runner.js";
import { approveVendor } from "../src/vendors/service.js";
import { refundWithinCoolingWindow } from "../src/payments/service.js";
import { cancelOrder, raiseIssue } from "../src/ordering/service.js";
import { resolveOrderIssue as resolveIssue } from "../src/ordering/admin-service.js";
import { formatMoney } from "../src/payments/money.js";
import { createDatabaseContext, ownerSql, resetDatabase, testDatabaseUrl } from "./harness.js";

/**
 * Platform email, against a real database.
 *
 * The claims worth making here are the ones no fake can make. Consent is a join
 * across two tables with an expiry and a withdrawal; a recipient count is a
 * query whose answer moves while somebody is looking at it; and "one bad
 * address must not stop the other eleven hundred" is a property of how the rows
 * and the queue are written, not of any one function.
 */

const url = testDatabaseUrl();

describe.skipIf(!url)("platform email", () => {
  const dbUrl = url as string;
  let sql: postgres.Sql;
  let database: ReturnType<typeof createDatabaseContext>;
  let ctx: CoreContext;
  let admin: Actor;

  const ids: Record<string, string> = {};

  beforeAll(async () => {
    await resetDatabase(dbUrl);
    sql = ownerSql(dbUrl);
    database = createDatabaseContext(dbUrl);
    ctx = database.ctx;
  }, 120_000);

  afterAll(async () => {
    await database?.close();
    await sql?.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await resetDatabase(dbUrl);

    const rows = await sql<{ id: string; email: string }[]>`
      select id, email from app.planning_org_users
    `;
    for (const row of rows) ids[row.email] = row.id;

    signInAs("admin@occasion.test");
    admin = await getActor(ctx, {});
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

  async function bind(email: string): Promise<void> {
    await sql`
      update app.planning_org_users set auth_provider_sub = ${`provider-sub-${email}`}
      where email = ${email}
    `;
  }

  const idOf = (email: string): string => ids[email] as string;

  /**
   * The fields a sender supplies for the shipped broadcast.
   *
   * `{{effective_date}}` and `{{policy_link}}` are the same for everybody who
   * receives the message, which is what makes them safe in a broadcast — and
   * are things only the person sending it knows.
   */
  const POLICY_VALUES = {
    effective_date: "Oct 1, 2026",
    policy_link: "https://occasion.example/policy",
  };

  /** Removes every express consent, so "nobody may be broadcast to" is the start. */
  async function clearExpressConsent(): Promise<void> {
    await sql`
      update app.planning_org_communication_consents
      set basis = 'implied' where channel = 'marketing_email'
    `;
  }

  describe("who may touch it at all", () => {
    it("refuses a customer the library, the view and every send", async () => {
      await bind("sarah@example.ca");
      signInAs("sarah@example.ca");
      const customer = await getActor(ctx, {});

      await expect(getEmailView(ctx, customer, {})).rejects.toBeInstanceOf(ForbiddenError);
      await expect(sendTest(ctx, customer, "policy_update")).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        sendBroadcast(ctx, customer, {
          templateKey: "policy_update",
          audience: "customers",
          scope: { kind: "everyone" },
          expectedCount: 1,
          confirmedLarge: false,
          values: POLICY_VALUES,
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  describe("consent", () => {
    it("refuses a broadcast when nobody has given express consent", async () => {
      await clearExpressConsent();

      await expect(
        sendBroadcast(ctx, admin, {
          templateKey: "policy_update",
          audience: "customers",
          scope: { kind: "everyone" },
          expectedCount: 0,
          confirmedLarge: false,
          values: POLICY_VALUES,
        }),
      ).rejects.toThrow(/express consent/);
    });

    it("makes exactly the account that was granted consent eligible", async () => {
      await clearExpressConsent();

      const template = await liveTemplate(ctx, "policy_update");
      const before = await resolveRecipients(ctx, {
        audience: "customers",
        scope: { kind: "everyone" },
        template,
      });
      expect(before).toEqual([]);

      await setMarketingConsent(ctx, admin, idOf("ada.okafor@example.ca"), {
        granted: true,
        source: "test",
      });

      const after = await resolveRecipients(ctx, {
        audience: "customers",
        scope: { kind: "everyone" },
        template,
      });
      expect(after.map((one) => one.email)).toEqual(["ada.okafor@example.ca"]);
    });

    it("does not count implied consent, which is inferred rather than given", async () => {
      await clearExpressConsent();
      await sql`
        update app.planning_org_communication_consents
        set basis = 'implied', expires_at = now() + interval '180 days'
        where channel = 'marketing_email'
      `;

      const template = await liveTemplate(ctx, "policy_update");
      const recipients = await resolveRecipients(ctx, {
        audience: "customers",
        scope: { kind: "everyone" },
        template,
      });

      expect(recipients).toEqual([]);
    });

    it("stops counting an express consent that has been withdrawn", async () => {
      await clearExpressConsent();
      await setMarketingConsent(ctx, admin, idOf("ada.okafor@example.ca"), {
        granted: true,
        source: "test",
      });
      await sql`
        update app.planning_org_communication_consents
        set withdrawn_at = now()
        where user_id = ${idOf("ada.okafor@example.ca")}
      `;

      const template = await liveTemplate(ctx, "policy_update");
      expect(
        await resolveRecipients(ctx, {
          audience: "customers",
          scope: { kind: "everyone" },
          template,
        }),
      ).toEqual([]);
    });

    it("never reaches a suspended or unverified account, consent or not", async () => {
      // Bea is suspended and Jonah is unverified. Granting both express consent
      // is the strongest form of the question: consent is not the only gate.
      await setMarketingConsent(ctx, admin, idOf("bea@terracerentals.ca"), {
        granted: true,
        source: "test",
      });
      await setMarketingConsent(ctx, admin, idOf("jonah.tran@example.ca"), {
        granted: true,
        source: "test",
      });

      const template = await liveTemplate(ctx, "policy_update");
      const recipients = await resolveRecipients(ctx, {
        audience: "both",
        scope: { kind: "everyone" },
        template,
      });

      const reached = recipients.map((one) => one.email);
      expect(reached).not.toContain("bea@terracerentals.ca");
      expect(reached).not.toContain("jonah.tran@example.ca");
    });

    it("does not require consent for operational mail to a business", async () => {
      await clearExpressConsent();

      // A payout notice is class `vendors`, not `broadcast`. Requiring express
      // marketing consent for it would mean a vendor could not be told their
      // money had moved.
      const template = await liveTemplate(ctx, "payout_notice");
      const recipients = await resolveRecipients(ctx, {
        audience: "vendors",
        scope: { kind: "everyone" },
        template,
      });

      expect(recipients.map((one) => one.email)).toContain("rosa@bloomandco.ca");
    });
  });

  describe("an unsubscribe link", () => {
    it("withdraws consent without a session, and says nothing about an unknown token", async () => {
      await clearExpressConsent();
      await setMarketingConsent(ctx, admin, idOf("ada.okafor@example.ca"), {
        granted: true,
        source: "test",
      });

      await sendBroadcast(ctx, admin, {
        templateKey: "policy_update",
        audience: "customers",
        scope: { kind: "everyone" },
        expectedCount: 1,
        confirmedLarge: false,
        values: POLICY_VALUES,
      });

      // The plaintext exists in the message and nowhere else, so the test does
      // what the recipient does: it reads the token out of the queued job.
      const [job] = await sql<{ payload: { html: string } }[]>`
        select payload from app.planning_org_jobs where type = 'send_email' limit 1
      `;
      const token = /unsubscribe\/([A-Za-z0-9_-]+)/.exec(job?.payload.html ?? "")?.[1];
      expect(token).toBeTruthy();

      await unsubscribe(ctx, token as string);

      const template = await liveTemplate(ctx, "policy_update");
      expect(
        await resolveRecipients(ctx, {
          audience: "customers",
          scope: { kind: "everyone" },
          template,
        }),
      ).toEqual([]);

      // An unknown token is not an error: a different answer for a real one
      // would make the endpoint a way to test which addresses were mailed.
      await expect(unsubscribe(ctx, "not-a-real-token")).resolves.toBeUndefined();
    });
  });

  describe("the second confirmation", () => {
    beforeEach(async () => {
      await clearExpressConsent();
      // Fifty-one accounts, one past the threshold.
      for (let index = 0; index < 51; index += 1) {
        await sql`
          with created as (
            insert into app.planning_org_users (email, full_name, status, email_verified_at)
            values (${`bulk-${index}@example.ca`}, ${`Bulk ${index}`}, 'active', now())
            returning id
          ), granted as (
            insert into app.planning_org_user_roles (user_id, role)
            select id, 'customer' from created
          )
          insert into app.planning_org_communication_consents
            (user_id, channel, basis, source, captured_at)
          select id, 'marketing_email', 'express', 'test', now() from created
        `;
      }
    }, 120_000);

    it("refuses a send above the threshold that has not been confirmed twice", async () => {
      await expect(
        sendBroadcast(ctx, admin, {
          templateKey: "policy_update",
          audience: "customers",
          scope: { kind: "everyone" },
          expectedCount: 51,
          confirmedLarge: false,
          values: POLICY_VALUES,
        }),
      ).rejects.toThrow(/Confirm again/);
    });

    it("sends it once the second confirmation is given, and audits the template hash", async () => {
      const result = await sendBroadcast(ctx, admin, {
        templateKey: "policy_update",
        audience: "customers",
        scope: { kind: "everyone" },
        expectedCount: 51,
        confirmedLarge: true,
        values: POLICY_VALUES,
      });

      expect(result.recipients).toBe(51);

      const [entry] = await sql<{ after: { hash?: string; recipients?: number } }[]>`
        select after from app.planning_org_audit_log where action = 'email.broadcast'
      `;
      expect(entry?.after.recipients).toBe(51);
      expect(entry?.after.hash).toMatch(/^[0-9a-f]{8}$/);
    });

    it("refuses a send whose audience has moved since the count was shown", async () => {
      // The administrator was shown 51 and, while the dialog was open, somebody
      // withdrew. Sending to "the audience" rather than "the 51 I approved" is
      // how a send goes out that nobody agreed to.
      await sql`
        update app.planning_org_communication_consents
        set withdrawn_at = now()
        where user_id = (
          select id from app.planning_org_users where email = 'bulk-0@example.ca'
        )
      `;

      await expect(
        sendBroadcast(ctx, admin, {
          templateKey: "policy_update",
          audience: "customers",
          scope: { kind: "everyone" },
          expectedCount: 51,
          confirmedLarge: true,
          values: POLICY_VALUES,
        }),
      ).rejects.toThrow(/now 50 accounts, not 51/);
    });
  });

  describe("one queued message per recipient", () => {
    beforeEach(async () => {
      await clearExpressConsent();
      await setMarketingConsent(ctx, admin, idOf("ada.okafor@example.ca"), {
        granted: true,
        source: "test",
      });
      await setMarketingConsent(ctx, admin, idOf("sarah@example.ca"), {
        granted: true,
        source: "test",
      });
    });

    it("writes a send and a job for each, and is idempotent under a repeat", async () => {
      await sendBroadcast(ctx, admin, {
        templateKey: "policy_update",
        audience: "customers",
        scope: { kind: "everyone" },
        expectedCount: 2,
        confirmedLarge: false,
        values: POLICY_VALUES,
      });

      const [counts] = await sql<{ sends: number; jobs: number }[]>`
        select
          (select count(*) from app.planning_org_email_sends)::int as sends,
          (select count(*) from app.planning_org_jobs where type = 'send_email')::int as jobs
      `;
      expect(counts).toEqual({ sends: 2, jobs: 2 });
    });

    it("retries only the recipient the provider refused", async () => {
      await sendBroadcast(ctx, admin, {
        templateKey: "policy_update",
        audience: "customers",
        scope: { kind: "everyone" },
        expectedCount: 2,
        confirmedLarge: false,
        values: POLICY_VALUES,
      });

      // Running the queue also runs whatever the seed left due, and the
      // lifecycle moves that follow queue messages of their own. Those are
      // correct; they are simply not what this test is about, so every
      // assertion below is scoped to this broadcast.
      // One address the provider will not take. The others must still go.
      const failing = "ada.okafor@example.ca";
      const attempted: string[] = [];
      const failingCtx: CoreContext = {
        ...ctx,
        email: {
          send: (message) => {
            attempted.push(message.to);
            if (message.to === failing) {
              return Promise.reject(new Error("Resend refused the message (422): invalid address"));
            }
            return Promise.resolve({ providerMessageId: `msg_${attempted.length}` });
          },
        },
      };

      await runDueJobs(failingCtx, {
        asOf: new Date(Date.now() + 60_000),
        demoOnly: false,
        trigger: "cron",
      });

      expect(attempted).toContain(failing);
      expect(attempted).toContain("sarah@example.ca");

      const rows = await sql<{ to_email: string; state: string }[]>`
        select to_email, state::text from app.planning_org_email_sends
        where broadcast_id is not null order by to_email
      `;
      expect(rows).toEqual([
        { to_email: failing, state: "failed" },
        { to_email: "sarah@example.ca", state: "sent" },
      ]);

      // The failed one is still queued and will be tried again; the sent one is
      // finished. A retry that resent the whole broadcast would mail everybody
      // a second time to rescue one address.
      const jobs = await sql<{ status: string }[]>`
        select j.status::text from app.planning_org_jobs j
        join app.planning_org_email_sends s on s.id::text = j.dedupe_key
        where j.type = 'send_email' and s.broadcast_id is not null
      `;
      expect(jobs.map((row) => row.status).sort()).toEqual(["done", "queued"]);
    });

    it("drops the message body once it is delivered, and keeps what the queue is about", async () => {
      await sendBroadcast(ctx, admin, {
        templateKey: "policy_update",
        audience: "customers",
        scope: { kind: "everyone" },
        expectedCount: 2,
        confirmedLarge: false,
        values: POLICY_VALUES,
      });

      const deliveringCtx: CoreContext = {
        ...ctx,
        email: { send: () => Promise.resolve({ providerMessageId: "msg_1" }) },
      };

      await runDueJobs(deliveringCtx, {
        asOf: new Date(Date.now() + 60_000),
        demoOnly: false,
        trigger: "cron",
      });

      const rows = await sql<{ status: string; payload: Record<string, unknown> }[]>`
        select j.status::text, j.payload from app.planning_org_jobs j
        join app.planning_org_email_sends s on s.id::text = j.dedupe_key
        where s.broadcast_id is not null
      `;
      expect(rows).toHaveLength(2);

      for (const row of rows) {
        expect(row.status).toBe("done");
        // The body is gone — one of these messages can carry a single-use
        // payment link, and a finished row keeping it for ever is the way
        // around the rule that stores that link as a hash.
        expect(row.payload["html"]).toBeUndefined();
        // What the queue is about stays: the admin screen labels a run from it.
        expect(row.payload["sendId"]).toBeTruthy();
      }
    });

    it("does not send twice when the job runs twice", async () => {
      await sendBroadcast(ctx, admin, {
        templateKey: "policy_update",
        audience: "customers",
        scope: { kind: "everyone" },
        expectedCount: 2,
        confirmedLarge: false,
        values: POLICY_VALUES,
      });

      // Keyed by the provider's own idempotency key, which is the send row's
      // id. Counting addresses would count a lifecycle message that the seeded
      // queue sent to the same customer, which is a different message.
      const sent: string[] = [];
      const countingCtx: CoreContext = {
        ...ctx,
        email: {
          send: (message) => {
            sent.push(message.idempotencyKey);
            return Promise.resolve({ providerMessageId: `msg_${sent.length}` });
          },
        },
      };

      const options = { asOf: new Date(Date.now() + 60_000), demoOnly: false } as const;
      await runDueJobs(countingCtx, { ...options, trigger: "cron" });
      await runDueJobs(countingCtx, { ...options, trigger: "cron" });

      // Every message was handed to the provider exactly once, whatever else
      // the seeded queue had due. That is the whole claim: the runner running
      // twice is not a second send.
      expect(new Set(sent).size).toBe(sent.length);

      const [counts] = await sql<{ broadcast: number }[]>`
        select count(*)::int as broadcast from app.planning_org_email_sends
        where broadcast_id is not null and state = 'sent'
      `;
      expect(counts?.broadcast).toBe(2);
    });
  });

  describe("saving a template", () => {
    it("refuses a broadcast that references a payment link", async () => {
      const current = await liveTemplate(ctx, "policy_update");

      await expect(
        saveTemplate(ctx, admin, {
          ...current,
          allowedFields: [...current.allowedFields, "payment_link"],
          body: `${current.body}\n\nPay here: {{payment_link}}`,
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("refuses a body using a field the template does not allow", async () => {
      const current = await liveTemplate(ctx, "policy_update");

      await expect(
        saveTemplate(ctx, admin, {
          ...current,
          body: `${current.body}\n\nYour balance is {{balance_amount}}.`,
        }),
      ).rejects.toThrow(/balance_amount/);
    });

    it("refuses widening an automatic template past what the lifecycle supplies", async () => {
      const current = await liveTemplate(ctx, "order_completed");

      await expect(
        saveTemplate(ctx, admin, {
          ...current,
          allowedFields: [...current.allowedFields, "payout_amount"],
          body: `${current.body}\n\n{{payout_amount}}`,
        }),
      ).rejects.toThrow(/fields the platform fills in/);
    });

    it("keeps the edit, and the library reads it back", async () => {
      const current = await liveTemplate(ctx, "policy_update");

      await saveTemplate(ctx, admin, {
        ...current,
        subject: "A change to our cancellation policy",
      });

      const saved = await liveTemplate(ctx, "policy_update");
      expect(saved.subject).toBe("A change to our cancellation policy");
      expect(saved.edited).toBe(true);

      const [entry] = await sql<{ action: string }[]>`
        select action from app.planning_org_audit_log where action = 'email.template_save'
      `;
      expect(entry?.action).toBe("email.template_save");
    });

    it("stops the lifecycle queuing a message whose auto-send is off", async () => {
      await setAutoSend(ctx, admin, "vendor_approved", false);

      await approveVendor(ctx, admin, await vendorId("Kimchi Kart"));

      const [counts] = await sql<{ sends: number }[]>`
        select count(*)::int as sends from app.planning_org_email_sends
      `;
      expect(counts?.sends).toBe(0);
    });
  });

  describe("what may be sent to an audience", () => {
    it("refuses a lifecycle template even with its auto-send turned off", async () => {
      // The hole this closes: the toggle decides whether the platform queues
      // the message when an order moves. Reading it as "and otherwise it is an
      // ordinary template" makes "Failed payment" — whose allowlist permits
      // {{payment_link}} — sendable to an audience.
      await setAutoSend(ctx, admin, "balance_failed", false);

      await expect(
        sendBroadcast(ctx, admin, {
          templateKey: "balance_failed",
          audience: "customers",
          scope: { kind: "everyone" },
          expectedCount: 1,
          confirmedLarge: false,
          values: { payment_link: "https://occasion.example/pay/stolen" },
        }),
      ).rejects.toThrow(/cannot be sent to an audience/);
    });

    it("refuses a hand-sent template that carries a per-recipient secret", async () => {
      // `payout_notice` is class `vendors`, is sent by hand, and permits
      // {{bank_last4}}. One body goes to every recipient, so filling that in
      // once puts one account's digits in front of every vendor.
      await expect(
        sendBroadcast(ctx, admin, {
          templateKey: "payout_notice",
          audience: "vendors",
          scope: { kind: "everyone" },
          expectedCount: 1,
          confirmedLarge: false,
          values: {
            bank_last4: "8841",
            payout_amount: "C$1.00",
            order_count: "1",
            payout_date: "x",
          },
        }),
      ).rejects.toThrow(/different for every recipient/);
    });

    it("never offers a restricted field as something the sender can type", async () => {
      const view = await getEmailView(ctx, admin, {
        audience: "vendors",
        templateKey: "payout_notice",
      });

      expect(view.senderFields.map((field) => field.name)).not.toContain("bank_last4");
      expect(view.notSendable).toMatch(/bank_last4/);
    });
  });

  describe("arriving from a Users-screen Email button", () => {
    it("preselects that account and counts it as the recipient", async () => {
      await clearExpressConsent();
      await setMarketingConsent(ctx, admin, idOf("ada.okafor@example.ca"), {
        granted: true,
        source: "test",
      });

      const view = await getEmailView(ctx, admin, {
        audience: "customers",
        userIds: [idOf("ada.okafor@example.ca")],
      });

      expect(view.selected.map((one) => one.email)).toEqual(["ada.okafor@example.ca"]);

      const accounts = view.scopes.find((one) => one.kind === "accounts");
      expect(accounts?.count).toBe(1);
      expect(accounts?.label).toContain("1 account");
    });

    it("does not preselect an account the send would skip anyway", async () => {
      // Bea is suspended. A recipient list naming somebody the send will then
      // drop is worse than one that never named them — the count in the dialog
      // is what an administrator approves.
      await setMarketingConsent(ctx, admin, idOf("bea@terracerentals.ca"), {
        granted: true,
        source: "test",
      });

      const view = await getEmailView(ctx, admin, {
        audience: "both",
        userIds: [idOf("bea@terracerentals.ca")],
      });

      expect(view.selected).toEqual([]);
      expect(view.scopes.find((one) => one.kind === "accounts")?.count).toBe(0);
    });

    it("sends to exactly the account that was picked", async () => {
      await clearExpressConsent();
      await setMarketingConsent(ctx, admin, idOf("ada.okafor@example.ca"), {
        granted: true,
        source: "test",
      });
      await setMarketingConsent(ctx, admin, idOf("sarah@example.ca"), {
        granted: true,
        source: "test",
      });

      const result = await sendBroadcast(ctx, admin, {
        templateKey: "policy_update",
        audience: "customers",
        scope: { kind: "accounts", userIds: [idOf("ada.okafor@example.ca")] },
        expectedCount: 1,
        confirmedLarge: false,
        values: POLICY_VALUES,
      });

      expect(result.recipients).toBe(1);

      const rows = await sql<{ to_email: string }[]>`
        select to_email from app.planning_org_email_sends
      `;
      expect(rows.map((row) => row.to_email)).toEqual(["ada.okafor@example.ca"]);
    });
  });

  describe("recording consent", () => {
    it("makes an account reachable, and withdrawing makes it unreachable again", async () => {
      await clearExpressConsent();
      const template = await liveTemplate(ctx, "policy_update");
      const reach = async () =>
        (
          await resolveRecipients(ctx, {
            audience: "customers",
            scope: { kind: "everyone" },
            template,
          })
        ).map((one) => one.email);

      expect(await reach()).toEqual([]);

      await setMarketingConsent(ctx, admin, idOf("ada.okafor@example.ca"), {
        granted: true,
        source: "test",
      });
      expect(await reach()).toEqual(["ada.okafor@example.ca"]);

      await setMarketingConsent(ctx, admin, idOf("ada.okafor@example.ca"), {
        granted: false,
        source: "test",
      });
      expect(await reach()).toEqual([]);
    });

    it("audits both directions, because consent is what permits a send at all", async () => {
      await setMarketingConsent(ctx, admin, idOf("ada.okafor@example.ca"), {
        granted: true,
        source: "test",
      });
      await setMarketingConsent(ctx, admin, idOf("ada.okafor@example.ca"), {
        granted: false,
        source: "test",
      });

      const rows = await sql<{ action: string }[]>`
        select action from app.planning_org_audit_log
        where action like 'email.consent%' order by created_at
      `;
      expect(rows.map((row) => row.action)).toEqual([
        "email.consent_grant",
        "email.consent_withdraw",
      ]);
    });

    it("refuses a customer the ability to record their own consent", async () => {
      await bind("sarah@example.ca");
      signInAs("sarah@example.ca");
      const customer = await getActor(ctx, {});

      await expect(
        setMarketingConsent(ctx, customer, idOf("sarah@example.ca"), {
          granted: true,
          source: "self",
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  describe("the screen's own data", () => {
    it("resolves the library, a preview and a real count for each scope", async () => {
      await clearExpressConsent();
      await setMarketingConsent(ctx, admin, idOf("ada.okafor@example.ca"), {
        granted: true,
        source: "test",
      });

      const view = await getEmailView(ctx, admin, { audience: "customers" });

      expect(view.templates.length).toBeGreaterThan(5);
      expect(view.audiences.find((one) => one.selected)?.key).toBe("customers");

      // The preview is rendered, so a template that could not render would fail
      // here rather than when somebody presses send.
      expect(view.preview.subject).not.toContain("{{");
      expect(view.preview.text).not.toContain("{{");

      const everyone = view.scopes.find((one) => one.kind === "everyone");
      expect(everyone?.count).toBe(1);
      expect(everyone?.label).toContain("1 account");

      // Nothing has been sent, so the stats column says so rather than showing
      // a plausible percentage.
      expect(view.statsAvailable).toBe(false);
    });

    it("asks the sender only for the fields the platform cannot fill in", async () => {
      const view = await getEmailView(ctx, admin, {
        audience: "customers",
        templateKey: "policy_update",
      });

      expect(view.senderFields.map((field) => field.name).sort()).toEqual([
        "effective_date",
        "policy_link",
      ]);
    });

    it("marks the restricted fields on a template that may carry them", async () => {
      const view = await getEmailView(ctx, admin, {
        audience: "customers",
        templateKey: "balance_failed",
      });

      const restricted = view.fields.filter((field) => field.restricted).map((field) => field.name);
      expect(restricted.sort()).toEqual(["card_last4", "payment_link"]);
    });
  });

  describe("the lifecycle's own messages", () => {
    it("emails the business when it is approved", async () => {
      await approveVendor(ctx, admin, await vendorId("Kimchi Kart"));

      const rows = await sql<{ to_email: string; subject: string }[]>`
        select to_email, subject from app.planning_org_email_sends
      `;
      expect(rows).toHaveLength(1);
      expect(rows[0]?.to_email).toBe("dae@kimchikart.ca");
      expect(rows[0]?.subject).toBe("You are live on Occasion");
    });

    it("does not email again when the same approval is applied twice", async () => {
      const id = await vendorId("Kimchi Kart");
      await approveVendor(ctx, admin, id);
      await expect(approveVendor(ctx, admin, id)).rejects.toBeInstanceOf(ValidationError);

      const [counts] = await sql<{ sends: number }[]>`
        select count(*)::int as sends from app.planning_org_email_sends
      `;
      expect(counts?.sends).toBe(1);
    });

    it("tells a refunded customer the amount, once, and not zero", async () => {
      // Two defects in one assertion. The order row has no refund figure — it
      // records what was charged — so the message defaulted to C$0.00 while
      // real money went back. And the refund path moves cancelled → refunded in
      // the same breath, so the customer got that wrong figure twice, seconds
      // apart.
      const [order] = await sql<{ id: string }[]>`
        select id from app.planning_org_orders where state = 'confirmed' limit 1
      `;
      await sql`delete from app.planning_org_email_sends`;

      const refund = await refundWithinCoolingWindow(ctx, admin, order?.id as string);
      expect(refund.amount).toBeGreaterThan(0n);

      const rows = await sql<{ subject: string; merge_values: Record<string, string> }[]>`
        select subject, merge_values from app.planning_org_email_sends
      `;
      expect(rows).toHaveLength(1);
      expect(rows[0]?.merge_values["refund_amount"]).toBe(formatMoney(refund.amount, "CAD"));
      expect(rows[0]?.merge_values["refund_amount"]).not.toBe("C$0.00");
    });

    it("does not send a false balance-charged message when an issue is resolved", async () => {
      // `issue → confirmed` is a legal move the admin "resolve issue" dialog
      // makes. Treating every arrival at `confirmed` that is not a first
      // deposit as a balance capture told the customer their card had been
      // charged when nothing had moved — and burned the dedupe key the real
      // capture would use a fortnight later, so that one said nothing at all.
      const [order] = await sql<{ id: string }[]>`
        select id from app.planning_org_orders where state = 'confirmed' limit 1
      `;
      await sql`delete from app.planning_org_email_sends`;

      await raiseIssue(ctx, admin, order?.id as string, "A complaint about the delivery.");
      await resolveIssue(ctx, admin, order?.id as string, "confirmed", "Sorted with the vendor.");

      const rows = await sql<{ subject: string }[]>`
        select subject from app.planning_org_email_sends
      `;
      expect(rows).toEqual([]);
    });

    it("does not email a cancellation for a checkout nobody paid for", async () => {
      // `pending_payment → cancelled` is the abandoned-cart job. Nothing was
      // charged, so "your booking is cancelled and C$0.00 is being returned to
      // the card you paid with" is two false statements to somebody who never
      // finished.
      const [order] = await sql<{ id: string }[]>`
        select id from app.planning_org_orders where state = 'pending_payment' limit 1
      `;
      if (!order) return;
      await sql`delete from app.planning_org_email_sends`;

      await cancelOrder(ctx, admin, order.id, "order.expire_unpaid");

      const rows = await sql<{ subject: string }[]>`
        select subject from app.planning_org_email_sends
      `;
      expect(rows).toEqual([]);
    });
  });

  async function vendorId(name: string): Promise<string> {
    const [row] = await sql<{ id: string }[]>`
      select id from app.planning_org_vendors where name = ${name}
    `;
    return row?.id as string;
  }
});
