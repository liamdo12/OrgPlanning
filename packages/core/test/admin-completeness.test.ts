import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type postgres from "postgres";
import { categories, messages, reviews, vendors } from "@occasion/db/schema";
import type { CoreContext } from "../src/context.js";
import type { Actor } from "../src/identity/actor.js";
import { getActor } from "../src/identity/service.js";
import { NotFoundError, ValidationError } from "../src/errors.js";
import {
  addDisputeNote,
  getDispute,
  listDisputes,
  openDispute,
  resolveDispute,
  startDisputeReview,
} from "../src/disputes/service.js";
import { decideReport, getReport, listReports, reportContent } from "../src/moderation/service.js";
import {
  createCategory,
  deleteCategory,
  listCategories,
  listSettings,
  moveCategory,
  updateCategory,
  updateSetting,
} from "../src/reference/service.js";
import { getAnalytics, windowFor } from "../src/analytics/service.js";
import { effectivePricing } from "../src/ordering/service.js";
import { raiseIssue } from "../src/ordering/service.js";
import { resolveOrderIssue } from "../src/ordering/admin-service.js";
import { REMOVED_TEXT } from "../src/moderation/targets.js";
import { createDatabaseContext, ownerSql, resetDatabase, testDatabaseUrl } from "./harness.js";

/**
 * The four capabilities the business proposal names and the prototype never
 * drew: complaints, moderation, categories and the platform's own numbers.
 *
 * The registries elsewhere prove that each of these is gated and audited. What
 * they cannot say is whether any of it *works* — whether closing a complaint
 * actually frees the booking it froze, whether deciding a report reaches the
 * words somebody reported, whether a rate an administrator types is the rate
 * the next booking is priced at. That is what this file is for.
 *
 * Each case resets nothing: they run in order against one seeded database and
 * say what they changed, the way the other database-backed suites here do.
 */

const url = testDatabaseUrl();

describe.skipIf(!url)("admin completeness", () => {
  const dbUrl = url as string;
  let sql: postgres.Sql;
  let database: ReturnType<typeof createDatabaseContext>;
  let ctx: CoreContext;
  let admin: Actor;
  let customer: Actor;

  beforeAll(async () => {
    await resetDatabase(dbUrl);
    sql = ownerSql(dbUrl);
    database = createDatabaseContext(dbUrl);
    ctx = database.ctx;

    await sql`update app.planning_org_users set auth_provider_sub = 'provider-sub-' || email`;

    admin = await actorFor("admin@occasion.test");
    customer = await actorFor("sarah@example.ca");
  }, 180_000);

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

  async function orderId(reference: string): Promise<string> {
    const [row] = await sql<{ id: string }[]>`
      select id from app.planning_org_orders where reference = ${reference}
    `;
    return row?.id as string;
  }

  describe("complaints", () => {
    it("lists what the seed opened, oldest first", async () => {
      const list = await listDisputes(ctx, admin);

      expect(list.total).toBe(2);
      expect(list.counts.open).toBe(1);
      expect(list.counts.under_review).toBe(1);
      // The row carries the order, the business and the customer, so the queue
      // reads without a lookup per line.
      expect(list.rows[0]?.orderReference).toBeTruthy();
      expect(list.rows[0]?.vendorName).toBeTruthy();
      expect(list.rows[0]?.customerName).toBeTruthy();
    });

    it("carries the notes somebody has already written", async () => {
      const list = await listDisputes(ctx, admin, { state: "under_review" });
      const detail = await getDispute(ctx, admin, list.rows[0]?.id as string);

      expect(detail.notes).toHaveLength(1);
      expect(detail.notes[0]?.authorName).toBe("Occasion Admin");
    });

    it("refuses a resolution with no note", async () => {
      const list = await listDisputes(ctx, admin, { state: "open" });

      await expect(
        resolveDispute(ctx, admin, list.rows[0]?.id as string, {
          resolution: "dismissed",
          note: "   ",
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("refuses to move an order that is not waiting on the case", async () => {
      // The guard that matters in the other direction: closing an unrelated
      // complaint must not walk somebody's booking to a new state.
      const list = await listDisputes(ctx, admin, { state: "open" });

      await expect(
        resolveDispute(ctx, admin, list.rows[0]?.id as string, {
          resolution: "dismissed",
          note: "not related",
          orderTo: "cancelled",
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("closes a case and frees the order it froze", async () => {
      const id = await orderId("TO-4192");

      await raiseIssue(ctx, admin, id, "Customer says the delivery window slipped.");
      const disputeId = await openDispute(ctx, admin, id, {
        reason: "Delivery window",
        detail: "Raised by phone.",
      });

      await startDisputeReview(ctx, admin, disputeId);
      await addDisputeNote(ctx, admin, disputeId, "Vendor confirms the window was restated.");

      // The order is frozen and the case says why. Both halves have to move.
      const before = await getDispute(ctx, admin, disputeId);
      expect(before.orderInIssue).toBe(true);

      const result = await resolveDispute(ctx, admin, disputeId, {
        resolution: "vendor_warned",
        note: "Vendor warned; booking stands.",
        orderTo: "confirmed",
      });

      expect(result.state).toBe("resolved");
      expect(result.orderState).toBe("confirmed");

      const [order] = await sql<{ state: string; issue_note: string | null }[]>`
        select state, issue_note from app.planning_org_orders where id = ${id}
      `;
      expect(order?.state).toBe("confirmed");
      expect(order?.issue_note).toBeNull();
    });

    it("refuses an order state the lifecycle would not allow, and closes nothing", async () => {
      // The reason the order moves first inside the transaction: a refusal from
      // the lifecycle must not leave a case marked settled.
      const id = await orderId("TO-4191");
      await raiseIssue(ctx, admin, id, "Second complaint.");
      const disputeId = await openDispute(ctx, admin, id, { reason: "Second complaint" });

      await expect(
        resolveDispute(ctx, admin, disputeId, {
          resolution: "dismissed",
          note: "nothing in it",
          orderTo: "completed",
        }),
      ).rejects.toBeInstanceOf(ValidationError);

      const after = await getDispute(ctx, admin, disputeId);
      expect(after.dispute.state).toBe("open");
      expect(after.orderInIssue).toBe(true);

      // Left tidy for the case below, through the path that owns it.
      await resolveOrderIssue(ctx, admin, id, "confirmed", "Withdrawn.");
    });

    it("closes the open cases when the orders screen resolves the issue", async () => {
      // The other direction of the link. An administrator can take a booking
      // out of `issue` from the orders screen without ever opening the queue,
      // and a case left open against it is an entry nobody can action.
      const id = await orderId("TO-4188");
      await raiseIssue(ctx, admin, id, "Flagged from the orders screen.");
      const disputeId = await openDispute(ctx, admin, id, { reason: "From the orders screen" });

      await resolveOrderIssue(ctx, admin, id, "fulfilled", "Settled with the customer.");

      const after = await getDispute(ctx, admin, disputeId);
      expect(after.dispute.state).toBe("resolved");
      expect(after.dispute.resolution).toBe("refund_recorded");
    });

    it("will not reopen a closed case", async () => {
      const list = await listDisputes(ctx, admin, { state: "resolved" });
      const id = list.rows[0]?.id as string;

      await expect(startDisputeReview(ctx, admin, id)).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe("moderation", () => {
    it("shows the reported words beside the report", async () => {
      const list = await listReports(ctx, admin, { open: true });

      expect(list.open).toBeGreaterThan(0);
      for (const row of list.rows) {
        expect(row.content).toBeDefined();
        expect(row.content.present).toBe(true);
      }
    });

    it("offers a profile line two decisions rather than three", async () => {
      // There is nowhere to hide a one-line profile to, so the screen does not
      // draw a button that would do the same thing as the one beside it.
      const list = await listReports(ctx, admin, { targetType: "vendor_profile" });
      expect(list.rows[0]?.choices).toEqual(["keep", "remove"]);

      const reviews = await listReports(ctx, admin, { targetType: "review" });
      expect(reviews.rows[0]?.choices).toEqual(["keep", "hide", "remove"]);
    });

    it("refuses a decision that does not apply to the content", async () => {
      const list = await listReports(ctx, admin, { targetType: "vendor_profile" });

      await expect(
        decideReport(ctx, admin, list.rows[0]?.id as string, { decision: "hide" }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("hides a review without destroying what it said", async () => {
      const list = await listReports(ctx, admin, { targetType: "review" });
      const report = list.rows[0];
      const result = await decideReport(ctx, admin, report?.id as string, {
        decision: "hide",
        note: "Borderline; taken down pending a second look.",
      });

      expect(result.decision).toBe("hide");

      const [row] = await ctx.db
        .select({ moderation: reviews.moderation, body: reviews.body })
        .from(reviews)
        .where(eq(reviews.id, report?.targetId as string));

      expect(row?.moderation).toBe("rejected");
      // The words are still there: hiding is reversible and this is what makes
      // it so.
      expect(row?.body).not.toBe(REMOVED_TEXT);
      expect(row?.body).toBeTruthy();
    });

    it("refuses to decide the same report twice", async () => {
      const list = await listReports(ctx, admin, { targetType: "review" });
      const decided = list.rows.find((row) => !row.open);

      await expect(
        decideReport(ctx, admin, decided?.id as string, { decision: "keep" }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("removes a profile line, and the audit entry keeps what it said", async () => {
      const list = await listReports(ctx, admin, { targetType: "vendor_profile" });
      const report = list.rows.find((row) => row.open);
      const before = report?.content.body;
      expect(before).toBeTruthy();

      await decideReport(ctx, admin, report?.id as string, {
        decision: "remove",
        note: "Claim could not be substantiated.",
      });

      const [vendor] = await ctx.db
        .select({ tagline: vendors.tagline })
        .from(vendors)
        .where(eq(vendors.id, report?.targetId as string));
      expect(vendor?.tagline).toBeNull();

      const [entry] = await sql<{ before: { body: string } }[]>`
        select before from app.planning_org_audit_log
        where action = 'moderation.decide' and entity_id = ${report?.id as string}
      `;
      // The row no longer holds the words, so the entry is the only place left
      // to read what was taken down.
      expect(entry?.before.body).toBe(before);
    });

    it("redacts a message on removal and keeps the row", async () => {
      const [thread] = await sql<{ id: string }[]>`
        insert into app.planning_org_threads (subject) values ('Moderation fixture') returning id
      `;
      const [sender] = await sql<{ id: string }[]>`
        select id from app.planning_org_users where email = 'sarah@example.ca'
      `;
      const [message] = await sql<{ id: string }[]>`
        insert into app.planning_org_messages (thread_id, sender_user_id, body)
        values (${thread?.id as string}, ${sender?.id as string}, 'Call me on 555-0100.')
        returning id
      `;

      const reportId = await reportContent(ctx, admin, {
        targetType: "message",
        targetId: message?.id as string,
        reason: "Personal information",
      });

      await decideReport(ctx, admin, reportId, { decision: "remove" });

      const [row] = await ctx.db
        .select({ body: messages.body, moderation: messages.moderation })
        .from(messages)
        .where(eq(messages.id, message?.id as string));

      expect(row?.moderation).toBe("rejected");
      expect(row?.body).toBe(REMOVED_TEXT);
    });

    it("says so when the content has gone since it was reported", async () => {
      const [orphan] = await sql<{ id: string }[]>`
        insert into app.planning_org_content_reports (target_type, target_id, reason)
        values ('review', gen_random_uuid(), 'about something deleted')
        returning id
      `;

      const detail = await getReport(ctx, admin, orphan?.id as string);

      // Said out loud rather than rendered as a blank row, which looks like a
      // bug rather than like a report somebody can close in a second.
      expect(detail.report.content.present).toBe(false);
      expect(detail.report.content.context).toBe("No longer on the platform");
    });

    it("refuses a report about content that does not exist", async () => {
      await expect(
        reportContent(ctx, customer, {
          targetType: "review",
          targetId: "00000000-0000-4000-8000-000000000000",
          reason: "nothing there",
        }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("categories", () => {
    it("refuses to delete one that has services, and says what to do instead", async () => {
      const list = await listCategories(ctx, admin);
      const inUse = list.find((row) => !row.deletable);

      expect(inUse?.inUseBy).toMatch(/service/);
      await expect(deleteCategory(ctx, admin, inUse?.id as string)).rejects.toThrow(/Deactivate/);
    });

    it("deactivates instead, leaving the listings where they were filed", async () => {
      const list = await listCategories(ctx, admin);
      const inUse = list.find((row) => !row.deletable);

      await updateCategory(ctx, admin, inUse?.id as string, { active: false });

      const [row] = await ctx.db
        .select({ active: categories.active })
        .from(categories)
        .where(eq(categories.id, inUse?.id as string));
      expect(row?.active).toBe(false);

      const [count] = await sql<{ total: number }[]>`
        select count(*)::int as total from app.planning_org_services
        where category_id = ${inUse?.id as string}
      `;
      expect(count?.total).toBeGreaterThan(0);

      await updateCategory(ctx, admin, inUse?.id as string, { active: true });
    });

    it("creates one with a slug derived from the name, and deletes it again", async () => {
      const id = await createCategory(ctx, admin, { name: "Lighting & Décor" });

      const created = (await listCategories(ctx, admin)).find((row) => row.id === id);
      expect(created?.slug).toBe("lighting-decor");
      expect(created?.deletable).toBe(true);

      await deleteCategory(ctx, admin, id);
      expect((await listCategories(ctx, admin)).some((row) => row.id === id)).toBe(false);
    });

    it("refuses a second category at the same slug", async () => {
      await expect(
        createCategory(ctx, admin, { name: "Flowers", slug: "flowers" }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("moves one down the list and renumbers the rest", async () => {
      const before = await listCategories(ctx, admin);
      const first = before[0];

      await moveCategory(ctx, admin, first?.id as string, "down");

      const after = await listCategories(ctx, admin);
      expect(after[1]?.id).toBe(first?.id);
      // Contiguous afterwards, which is what makes the next move mean
      // something: a swap between two rows sharing a sort order does nothing.
      expect(after.map((row) => row.sortOrder)).toEqual(after.map((_, index) => index));

      await moveCategory(ctx, admin, first?.id as string, "up");
    });

    it("refuses to move the first one up", async () => {
      const list = await listCategories(ctx, admin);

      await expect(
        moveCategory(ctx, admin, list[0]?.id as string, "up"),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe("platform settings", () => {
    it("lists every setting the platform has, with where each one is read", async () => {
      const list = await listSettings(ctx, admin);

      expect(list).toHaveLength(8);
      for (const setting of list) {
        expect(setting.source).toBeTruthy();
      }
      // Three are decided elsewhere and say so rather than offering a field
      // that would do nothing.
      expect(list.filter((setting) => !setting.editable).map((setting) => setting.key)).toEqual([
        "auto_complete_hours",
        "balance_grace_hours",
        "currency",
      ]);
    });

    it("refuses to set one that is not set here", async () => {
      await expect(updateSetting(ctx, admin, "currency", "USD")).rejects.toBeInstanceOf(
        ValidationError,
      );
    });

    it("refuses a rate outside its bounds, and a fraction of a basis point", async () => {
      await expect(updateSetting(ctx, admin, "commission_bps", "9000")).rejects.toThrow(
        /cannot be above/,
      );
      await expect(updateSetting(ctx, admin, "commission_bps", "10.5")).rejects.toThrow(
        /whole number/,
      );
    });

    it("changes what the next booking is priced at", async () => {
      // The claim that makes this screen worth having. Without it the form
      // writes to a table nobody reads.
      const before = await effectivePricing(ctx);
      expect(before.commissionBps).toBe(1000);

      await updateSetting(ctx, admin, "commission_bps", "1200");
      await updateSetting(ctx, admin, "balance_lead_days", "21");

      const after = await effectivePricing(ctx);
      expect(after.commissionBps).toBe(1200);
      expect(after.policy.balanceLeadDays).toBe(21);

      await updateSetting(ctx, admin, "commission_bps", "1000");
      await updateSetting(ctx, admin, "balance_lead_days", "14");
    });

    it("falls back to the context's own rate when the row is missing", async () => {
      await sql`delete from app.planning_org_platform_settings where key = 'commission_bps'`;

      // Not zero, and not `NaN`: a database that has never been seeded still
      // prices at a rate somebody vetted at boot.
      const pricing = await effectivePricing(ctx);
      expect(pricing.commissionBps).toBe(ctx.config.commissionBps);

      await updateSetting(ctx, admin, "commission_bps", "1000");
    });

    it("ignores a row holding something that is not a whole number", async () => {
      await sql`
        update app.planning_org_platform_settings set value = '"ten percent"'::jsonb
        where key = 'commission_bps'
      `;

      const pricing = await effectivePricing(ctx);
      expect(pricing.commissionBps).toBe(ctx.config.commissionBps);

      await sql`
        update app.planning_org_platform_settings set value = '1000'::jsonb
        where key = 'commission_bps'
      `;
    });
  });

  describe("analytics", () => {
    it("counts the standing populations now and the events over the period", async () => {
      const view = await getAnalytics(ctx, admin, "30d");

      expect(view.vendorsByStatus["approved"]).toBeGreaterThan(0);
      expect(view.usersByStatus["active"]).toBeGreaterThan(0);
      expect(view.bookings.orders).toBeGreaterThan(0);
      expect(view.bookings.gross).toBeGreaterThan(0n);
      expect(view.bookings.grossDisplay).toMatch(/^C\$/);
    });

    it("reports a rate as unavailable rather than computing one from nothing", async () => {
      // The seed queues jobs but runs none, so there is no job history at all —
      // and a failure rate of "0%" over no runs is a claim the data does not
      // support. The screen says "—" and means it.
      const view = await getAnalytics(ctx, admin, "30d");

      expect(view.jobFailures.denominator).toBe(0);
      expect(view.jobFailures.display).toBe("—");
    });

    it("widens with the period", async () => {
      const month = await getAnalytics(ctx, admin, "30d");
      const all = await getAnalytics(ctx, admin, "all");

      expect(all.bookings.orders).toBeGreaterThanOrEqual(month.bookings.orders);
      expect(all.window.from.getTime()).toBeLessThan(month.window.from.getTime());
    });

    it("reads the period off the domain clock, so a preview moves it", async () => {
      const at = new Date(Date.now() + 40 * 86_400_000);
      database.setDomainNow(at);

      const view = await getAnalytics(ctx, admin, "7d");
      expect(view.asOf.getTime()).toBe(at.getTime());
      expect(view.window).toEqual(windowFor("7d", at));

      database.setDomainNow(null);
    });

    it("runs a fixed number of queries whatever the period", async () => {
      // The claim a duration cannot make. Six aggregates, one snapshot, and no
      // query per row anywhere.
      const seen: string[] = [];
      const counted = createDatabaseContext(dbUrl, undefined, (query) => seen.push(query));

      try {
        counted.setUser({
          id: "provider-sub-admin@occasion.test",
          email: "admin@occasion.test",
          issuedAt: new Date(),
          emailVerified: true,
          secondFactorVerified: true,
        });
        const actor = await getActor(counted.ctx, {});

        seen.length = 0;
        await getAnalytics(counted.ctx, actor, "30d");
        const short = seen.filter((query) => query.includes("select")).length;

        seen.length = 0;
        await getAnalytics(counted.ctx, actor, "all");
        const long = seen.filter((query) => query.includes("select")).length;

        expect(short).toBe(long);
        expect(short).toBeLessThanOrEqual(8);
      } finally {
        await counted.close();
      }
    });
  });
});
