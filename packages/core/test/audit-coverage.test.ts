import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { desc, eq } from "drizzle-orm";
import type postgres from "postgres";
import { auditLog, jobRuns } from "@occasion/db/schema";
import type { CoreContext, DbExecutor } from "../src/context.js";
import type { Actor } from "../src/identity/actor.js";
import { getActor } from "../src/identity/service.js";
import { clearSecondFactor, setSecondFactorEnrolled } from "../src/identity/service.js";
import {
  approveUser,
  grantRoleToUser,
  reinstateAccount,
  resendVerification,
  revokeRoleFromUser,
  suspendAccount,
} from "../src/identity/admin-service.js";
import { inviteAdmin, revokeAdminInvite } from "../src/identity/invites.js";
import {
  approveVendor,
  blockVendor,
  markUnderReview,
  reinstateVendor,
  suspendVendor,
} from "../src/vendors/service.js";
import {
  markOrderFulfilled,
  recordDashboardRefund,
  refundCoolingWindow,
  resolveOrderIssue,
  retryBalance,
} from "../src/ordering/admin-service.js";
import { raiseIssue } from "../src/ordering/service.js";
import { recordExternalRefund } from "../src/payments/service.js";
import {
  requeueJob,
  runDemoJobs,
  setClockOverride,
  clearClockOverride,
} from "../src/jobs/admin-service.js";
import { runDueJobs } from "../src/jobs/runner.js";
import { saveTemplate, setMarketingConsent } from "../src/email/service.js";
import {
  addDisputeNote,
  assignDispute,
  openDispute,
  resolveDispute,
  startDisputeReview,
} from "../src/disputes/service.js";
import { decideReport, reportContent } from "../src/moderation/service.js";
import {
  addItemToPlan,
  cancelEvent,
  createEvent,
  removeItemFromPlan,
  updateEvent,
} from "../src/planning/service.js";
import {
  createCategory,
  deleteCategory,
  moveCategory,
  updateCategory,
  updateSetting,
} from "../src/reference/service.js";
import { builtInTemplate } from "../src/email/templates/index.js";
import { createStripeFake, type StripeFake } from "../src/testing/stripe-fake.js";
import { createDatabaseContext, ownerSql, resetDatabase, testDatabaseUrl } from "./harness.js";

/**
 * Nothing an administrator changes happens quietly.
 *
 * The audit log is the only answer to "who did this" that survives the person
 * leaving, and the only one available months later when a vendor disputes a
 * suspension or a customer disputes a refund. A missing entry is invisible
 * until the moment somebody needs it, which is the worst possible moment to
 * find out.
 *
 * Every mutating admin action is listed here with the entry it must write, so
 * this file doubles as the index the runbook reads from. Each case runs as the
 * administrator inside a transaction that is rolled back, and reads the entry
 * back through the same transaction — the row has to be written *with* the
 * change, not after it, or an entry will eventually describe a change that
 * never committed.
 *
 * The second half is the part a log of admin actions cannot cover on its own:
 * money the platform moved by itself, on a clock an administrator had shifted.
 * That provenance lives on `job_runs`, and "which admin's override, at what
 * effective time" has to be answerable from the run row alone.
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

type Subjects = {
  approvedVendorId: string;
  pendingVendorId: string;
  blockedVendorId: string;
  confirmedOrderId: string;
  actionRequiredOrderId: string;
  activeUserId: string;
  pendingUserId: string;
  suspendedUserId: string;
  unverifiedUserId: string;
  jobId: string;
  inviteId: string;
  disputeId: string;
  /** The administrator's own id: a case is assigned to an administrator. */
  adminUserId: string;
  reportId: string;
  categoryId: string;
  /** A category nothing is filed under, so deleting it is allowed. */
  emptyCategoryId: string;
  reviewId: string;
  /** Sarah's 30th, which the account holder owns. */
  eventId: string;
  /**
   * An event of hers with nothing live against it.
   *
   * Closing one is refused while any booking is still in flight, so the case
   * would fail on that rather than on the audit entry.
   */
  closableEventId: string;
  /** A bookable service, its category, and the slot on her event for it. */
  plannableServiceId: string;
  plannedCategoryId: string;
  plannedEventItemId: string;
};

/**
 * A person a case can run as, other than the administrator.
 *
 * Almost every audited action is an administrator's, so a case that says
 * nothing runs as one. The exceptions are the actions somebody takes on their
 * **own** account — nobody can enrol another person's second factor — and for
 * those the entry must name that person and the hat they were wearing, not an
 * administrator who was not involved.
 */
type CaseActorKey = "accountHolder";

/** Who wrote the entry, and what the entry must say about them. */
type Performer = { actor: Actor; userId: string; actingRole: string };

type Case = {
  /** The screen the action belongs to, for reading the table. */
  screen: string;
  what: string;
  /** Who performs it. Absent means the administrator. */
  actor?: CaseActorKey;
  /** The `action` string the entry must carry. */
  action: string;
  entityType: string;
  /** Which subject id the entry's `entity_id` must name, if any. */
  entity?: keyof Subjects;
  /** Whether the entry must record what the row looked like first. */
  before?: boolean;
  /** Puts the row in the state the action needs, inside the same transaction. */
  prepare?: (ctx: CoreContext, actor: Actor, s: Subjects) => Promise<void>;
  run: (ctx: CoreContext, actor: Actor, s: Subjects) => Promise<unknown>;
};

const CASES: readonly Case[] = [
  // ---- vendors -----------------------------------------------------------
  {
    screen: "vendors",
    what: "approving a vendor",
    action: "vendor.approve",
    entityType: "vendor",
    entity: "pendingVendorId",
    before: true,
    run: (c, a, s) => approveVendor(c, a, s.pendingVendorId),
  },
  {
    screen: "vendors",
    what: "suspending a vendor",
    action: "vendor.suspend",
    entityType: "vendor",
    entity: "approvedVendorId",
    before: true,
    run: (c, a, s) => suspendVendor(c, a, s.approvedVendorId, "chargebacks"),
  },
  {
    screen: "vendors",
    what: "blocking an application",
    action: "vendor.block",
    entityType: "vendor",
    entity: "pendingVendorId",
    before: true,
    run: (c, a, s) => blockVendor(c, a, s.pendingVendorId, "not eligible"),
  },
  {
    screen: "vendors",
    what: "reinstating a vendor",
    action: "vendor.reinstate",
    entityType: "vendor",
    entity: "approvedVendorId",
    before: true,
    prepare: (c, a, s) =>
      suspendVendor(c, a, s.approvedVendorId, "temporary").then(() => undefined),
    run: (c, a, s) => reinstateVendor(c, a, s.approvedVendorId),
  },
  {
    screen: "vendors",
    what: "sending a blocked business back to the queue",
    action: "vendor.review",
    entityType: "vendor",
    entity: "blockedVendorId",
    before: true,
    run: (c, a, s) => markUnderReview(c, a, s.blockedVendorId),
  },

  // ---- accounts ----------------------------------------------------------
  {
    screen: "users",
    what: "approving an account",
    action: "identity.user.approve",
    entityType: "user",
    entity: "pendingUserId",
    before: true,
    run: (c, a, s) => approveUser(c, a, s.pendingUserId),
  },
  {
    screen: "users",
    what: "suspending an account",
    action: "identity.user.suspend",
    entityType: "user",
    entity: "activeUserId",
    before: true,
    run: (c, a, s) => suspendAccount(c, a, s.activeUserId, "abuse"),
  },
  {
    screen: "users",
    what: "reinstating an account",
    action: "identity.user.reinstate",
    entityType: "user",
    entity: "suspendedUserId",
    before: true,
    run: (c, a, s) => reinstateAccount(c, a, s.suspendedUserId),
  },
  {
    screen: "users",
    what: "granting a role",
    action: "identity.role.grant",
    entityType: "user",
    entity: "activeUserId",
    run: (c, a, s) => grantRoleToUser(c, a, s.activeUserId, "vendor", undefined),
  },
  {
    screen: "users",
    what: "revoking a role",
    action: "identity.role.revoke",
    entityType: "user",
    entity: "activeUserId",
    // `customer` is not a role an administrator manages, so the revoke has to
    // be of one that is — granted first, in the same transaction.
    prepare: (c, a, s) => grantRoleToUser(c, a, s.activeUserId, "vendor", undefined),
    run: (c, a, s) => revokeRoleFromUser(c, a, s.activeUserId, "vendor"),
  },
  {
    screen: "users",
    what: "resending a verification email",
    action: "identity.user.resend_verification",
    entityType: "user",
    entity: "unverifiedUserId",
    run: (c, a, s) => resendVerification(c, a, s.unverifiedUserId),
  },
  {
    screen: "users",
    what: "clearing a lost second factor",
    action: "identity.mfa.clear",
    entityType: "user",
    entity: "activeUserId",
    run: (c, a, s) => clearSecondFactor(c, a, s.activeUserId),
  },
  {
    // The one entry here that no administrator writes. Enrolling is the
    // account holder's own choice, so the row names them and records the hat
    // they were wearing — and asserting that is the only way to know the log
    // can describe anybody but an administrator.
    screen: "account",
    what: "enrolling a second factor",
    actor: "accountHolder",
    action: "identity.mfa.enrol",
    entityType: "user",
    entity: "activeUserId",
    before: true,
    run: (c, a) => setSecondFactorEnrolled(c, a, true),
  },
  {
    screen: "users",
    what: "recording marketing consent",
    action: "email.consent_grant",
    entityType: "user",
    entity: "activeUserId",
    run: (c, a, s) => setMarketingConsent(c, a, s.activeUserId, { granted: true, source: "admin" }),
  },
  {
    screen: "admin",
    what: "inviting an administrator",
    action: "identity.admin.invite",
    entityType: "admin_invite",
    run: (c, a) => inviteAdmin(c, a, "new.admin@occasion.test"),
  },
  {
    screen: "admin",
    what: "revoking an invitation",
    action: "identity.admin.invite.revoke",
    entityType: "admin_invite",
    entity: "inviteId",
    run: (c, a, s) => revokeAdminInvite(c, a, s.inviteId),
  },

  // ---- orders and money --------------------------------------------------
  {
    screen: "orders",
    what: "marking an order fulfilled",
    action: "order.fulfil",
    entityType: "order",
    entity: "confirmedOrderId",
    before: true,
    run: (c, a, s) => markOrderFulfilled(c, a, s.confirmedOrderId),
  },
  {
    screen: "orders",
    what: "resolving a delivery issue",
    action: "order.resolve_issue",
    entityType: "order",
    entity: "confirmedOrderId",
    before: true,
    prepare: (c, a, s) => raiseIssue(c, a, s.confirmedOrderId, "late").then(() => undefined),
    run: (c, a, s) => resolveOrderIssue(c, a, s.confirmedOrderId, "confirmed", "sorted"),
  },
  {
    screen: "orders",
    what: "retrying a declined balance",
    // The retry of an order already waiting does not move it — it is already
    // where it needs to be — so there is no transition to carry the entry, and
    // what has to be logged is the new payment link it posts.
    action: "payment.balance_link_reissued",
    entityType: "order",
    entity: "actionRequiredOrderId",
    before: true,
    run: (c, a, s) => retryBalance(c, a, s.actionRequiredOrderId),
  },
  {
    screen: "orders",
    what: "refunding inside the cooling window",
    action: "payment.refunded",
    entityType: "order",
    entity: "confirmedOrderId",
    run: (c, a, s) => refundCoolingWindow(c, a, s.confirmedOrderId),
  },
  {
    screen: "orders",
    what: "recording a refund made in the provider's dashboard",
    action: "payment.record_external_refund",
    entityType: "order",
    entity: "confirmedOrderId",
    run: (c, a, s) =>
      recordDashboardRefund(c, a, s.confirmedOrderId, {
        providerRefundId: "re_dashboardOne",
        amount: 500n,
        reason: "goodwill",
      }),
  },
  {
    screen: "orders",
    what: "recording an external refund through the service",
    action: "payment.record_external_refund",
    entityType: "order",
    entity: "confirmedOrderId",
    run: (c, a, s) =>
      recordExternalRefund(c, a, s.confirmedOrderId, {
        providerRefundId: "re_dashboardTwo",
        amount: 500n,
        reason: "goodwill",
      }),
  },

  // ---- planning ------------------------------------------------------------
  //
  // All of these run as the account holder rather than as an administrator, and
  // that is the point: the policy behind them refuses administrators outright,
  // so an entry naming one could only have come from a path that should not
  // exist.
  {
    screen: "planner",
    what: "starting an event",
    actor: "accountHolder",
    action: "planning.event.create",
    entityType: "event",
    run: (c, a) => createEvent(c, a, { name: "Audit party", eventDate: "2027-07-04" }),
  },
  {
    screen: "planner",
    what: "changing an event's details",
    actor: "accountHolder",
    action: "planning.event.update",
    entityType: "event",
    entity: "eventId",
    before: true,
    run: (c, a, s) => updateEvent(c, a, s.eventId, { guestCount: 61 }),
  },
  {
    screen: "planner",
    what: "closing an event",
    actor: "accountHolder",
    action: "planning.event.cancel",
    entityType: "event",
    entity: "closableEventId",
    before: true,
    run: (c, a, s) => cancelEvent(c, a, s.closableEventId),
  },
  {
    screen: "planner",
    what: "putting a service in the plan",
    actor: "accountHolder",
    action: "planning.item.add",
    entityType: "event_item",
    entity: "plannedEventItemId",
    run: (c, a, s) =>
      addItemToPlan(c, a, { eventId: s.eventId, serviceId: s.plannableServiceId, quantity: 2 }),
  },
  {
    screen: "planner",
    what: "taking a service back out of the plan",
    actor: "accountHolder",
    action: "planning.item.remove",
    entityType: "event_item",
    entity: "plannedEventItemId",
    before: true,
    prepare: (c, a, s) =>
      addItemToPlan(c, a, { eventId: s.eventId, serviceId: s.plannableServiceId }).then(
        () => undefined,
      ),
    run: (c, a, s) =>
      removeItemFromPlan(c, a, { eventId: s.eventId, categoryId: s.plannedCategoryId }),
  },

  // ---- operations and email ----------------------------------------------
  {
    screen: "automations",
    what: "moving the demo clock",
    action: "ops.clock_override.set",
    entityType: "platform",
    run: (c, a) => setClockOverride(c, a, new Date(Date.now() + 86_400_000)),
  },
  {
    screen: "automations",
    what: "putting the clock back",
    action: "ops.clock_override.clear",
    entityType: "platform",
    prepare: (c, a) =>
      setClockOverride(c, a, new Date(Date.now() + 86_400_000)).then(() => undefined),
    run: (c, a) => clearClockOverride(c, a),
  },
  {
    screen: "automations",
    what: "re-queueing a parked job",
    action: "ops.job.requeue",
    entityType: "job",
    entity: "jobId",
    before: true,
    run: (c, a, s) => requeueJob(c, a, s.jobId),
  },
  {
    screen: "email",
    what: "saving a template",
    action: "email.template_save",
    entityType: "email_template",
    run: (c, a) => {
      // Saved as shipped but for the subject, so the entry is about an edit
      // somebody made rather than about a template that changed shape.
      const template = builtInTemplate("vendor_approved");
      if (!template) throw new Error("vendor_approved is not a shipped template");
      return saveTemplate(c, a, {
        key: template.key,
        name: template.name,
        trigger: template.trigger,
        autoSend: template.autoSend,
        subject: `${template.subject} `,
        body: template.body,
        allowedFields: template.allowedFields,
      });
    },
  },

  // ---- complaints ---------------------------------------------------------
  {
    screen: "disputes",
    what: "opening a case",
    action: "dispute.open",
    entityType: "dispute",
    run: (c, a, s) => openDispute(c, a, s.confirmedOrderId, { reason: "arrived late" }),
  },
  {
    screen: "disputes",
    what: "writing an internal note",
    action: "dispute.note",
    entityType: "dispute",
    entity: "disputeId",
    run: (c, a, s) => addDisputeNote(c, a, s.disputeId, "Called the vendor; no record of it."),
  },
  {
    screen: "disputes",
    what: "picking a case up",
    action: "dispute.assign",
    entityType: "dispute",
    entity: "disputeId",
    before: true,
    run: (c, a, s) => assignDispute(c, a, s.disputeId, s.adminUserId),
  },
  {
    screen: "disputes",
    what: "starting to investigate",
    action: "dispute.review",
    entityType: "dispute",
    entity: "disputeId",
    before: true,
    run: (c, a, s) => startDisputeReview(c, a, s.disputeId),
  },
  {
    screen: "disputes",
    what: "closing a case",
    action: "dispute.resolve",
    entityType: "dispute",
    entity: "disputeId",
    before: true,
    run: (c, a, s) =>
      resolveDispute(c, a, s.disputeId, {
        resolution: "vendor_warned",
        note: "Vendor warned; delivery window restated.",
      }),
  },

  // ---- moderation ---------------------------------------------------------
  {
    screen: "moderation",
    what: "reporting content",
    action: "moderation.report",
    entityType: "content_report",
    run: (c, a, s) =>
      reportContent(c, a, {
        targetType: "review",
        targetId: s.reviewId,
        reason: "Names a member of staff",
      }),
  },
  {
    screen: "moderation",
    what: "deciding a report",
    action: "moderation.decide",
    entityType: "content_report",
    entity: "reportId",
    // The words that were taken down: the row they were on no longer holds
    // them, so the entry is the only place left to read them.
    before: true,
    run: (c, a, s) => decideReport(c, a, s.reportId, { decision: "remove", note: "Unsupported." }),
  },

  // ---- categories and settings --------------------------------------------
  {
    screen: "categories",
    what: "creating a category",
    action: "category.create",
    entityType: "category",
    run: (c, a) => createCategory(c, a, { name: "Lighting" }),
  },
  {
    screen: "categories",
    what: "renaming a category",
    action: "category.update",
    entityType: "category",
    entity: "categoryId",
    before: true,
    run: (c, a, s) => updateCategory(c, a, s.categoryId, { name: "Flowers & plants" }),
  },
  {
    screen: "categories",
    what: "reordering the list",
    action: "category.reorder",
    entityType: "category",
    entity: "categoryId",
    before: true,
    run: (c, a, s) => moveCategory(c, a, s.categoryId, "down"),
  },
  {
    screen: "categories",
    what: "deleting an unused category",
    action: "category.delete",
    entityType: "category",
    entity: "emptyCategoryId",
    before: true,
    run: (c, a, s) => deleteCategory(c, a, s.emptyCategoryId),
  },
  {
    screen: "settings",
    what: "changing the commission",
    action: "settings.update",
    entityType: "platform_setting",
    // No `entity`: `audit_log.entity_id` is a uuid and a setting is keyed by
    // name, so the key travels in the payload instead.
    before: true,
    run: (c, a) => updateSetting(c, a, "commission_bps", "1200"),
  },
];

describe.skipIf(!url)("audit coverage", () => {
  const dbUrl = url as string;
  let sql: postgres.Sql;
  let database: ReturnType<typeof createDatabaseContext>;
  let ctx: CoreContext;
  let stripe: StripeFake;
  let admin: Actor;
  let adminId: string;
  let subjects: Subjects;
  let others: Record<CaseActorKey, Performer>;

  beforeAll(async () => {
    await resetDatabase(dbUrl);
    sql = ownerSql(dbUrl);
    stripe = createStripeFake();
    database = createDatabaseContext(dbUrl, stripe);
    ctx = database.ctx;

    await sql`update app.planning_org_users set auth_provider_sub = 'provider-sub-' || email`;
    // Every approved vendor needs a connected account before money can move.
    await sql`
      update app.planning_org_vendors
      set stripe_account_id = 'acct_test_' || left(id::text, 8),
          stripe_payouts_enabled_at = now()
      where status = 'approved'
    `;
    // Somebody has to have a second factor for clearing one to be a real move.
    await sql`
      update app.planning_org_users set mfa_enrolled_at = now() where email = 'sarah@example.ca'
    `;

    const signInAs = async (email: string): Promise<Actor> => {
      database.setUser({
        id: `provider-sub-${email}`,
        email,
        issuedAt: new Date(),
        emailVerified: true,
        secondFactorVerified: true,
      });
      return getActor(ctx, {});
    };

    // Built once, here, rather than inside the case that needs it: the adapter
    // reports one signed-in person at a time, so a case that changed it would
    // change it for every case after.
    const accountHolder = await signInAs("sarah@example.ca");

    // And back to the administrator, who runs everything else.
    admin = await signInAs("admin@occasion.test");
    adminId = (admin as Extract<Actor, { kind: "user" }>).userId;

    others = {
      accountHolder: {
        actor: accountHolder,
        userId: (accountHolder as Extract<Actor, { kind: "user" }>).userId,
        // Stated rather than read off the actor: the entry has to record the
        // hat this person was wearing, and reading it back off the same object
        // the action was given would assert nothing about what was written.
        actingRole: "customer",
      },
    };

    const one = async (query: postgres.PendingQuery<{ id: string }[]>) => {
      const [row] = await query;
      return row?.id as string;
    };

    const invite = await inviteAdmin(ctx, admin, "revoke.me@occasion.test");

    subjects = {
      approvedVendorId: await one(
        sql`select id from app.planning_org_vendors where slug = 'bloom-and-co'`,
      ),
      pendingVendorId: await one(
        sql`select id from app.planning_org_vendors where status = 'pending' limit 1`,
      ),
      blockedVendorId: await one(
        sql`select id from app.planning_org_vendors where status = 'blocked' limit 1`,
      ),
      confirmedOrderId: await one(
        sql`select id from app.planning_org_orders where reference = 'TO-4192'`,
      ),
      actionRequiredOrderId: await one(
        sql`select id from app.planning_org_orders where state = 'action_required' limit 1`,
      ),
      activeUserId: await one(
        sql`select id from app.planning_org_users where email = 'sarah@example.ca'`,
      ),
      pendingUserId: await one(
        sql`select id from app.planning_org_users where status = 'pending' limit 1`,
      ),
      suspendedUserId: await one(
        sql`select id from app.planning_org_users where status = 'suspended' limit 1`,
      ),
      unverifiedUserId: await one(
        sql`select id from app.planning_org_users where status = 'unverified' limit 1`,
      ),
      // `requeueJob` only acts on a parked job, and the seed parks none.
      jobId: await one(sql`
        update app.planning_org_jobs
        set status = 'held', held_reason = 'vendor suspended'
        where id = (select id from app.planning_org_jobs limit 1)
        returning id
      `),
      inviteId: invite.id,
      disputeId: await one(sql`
        select d.id from app.planning_org_disputes d
        join app.planning_org_orders o on o.id = d.order_id
        where o.reference = 'TO-4188'
      `),
      adminUserId: adminId,
      reportId: await one(
        sql`select id from app.planning_org_content_reports where target_type = 'vendor_profile'`,
      ),
      categoryId: await one(sql`select id from app.planning_org_categories where slug = 'flowers'`),
      emptyCategoryId: await one(sql`
        insert into app.planning_org_categories (slug, name, sort_order)
        values ('audit-only', 'Audit only', 99)
        returning id
      `),
      reviewId: await one(sql`select id from app.planning_org_reviews limit 1`),
      eventId: await one(sql`
        select id from app.planning_org_events where name = 'Sarah''s 30th'
      `),
      closableEventId: await one(sql`
        select id from app.planning_org_events where name = 'Baby shower'
      `),
      plannableServiceId: await one(sql`
        select s.id from app.planning_org_services s
        join app.planning_org_vendors v on v.id = s.vendor_id
        join app.planning_org_categories c on c.id = s.category_id
        where v.status = 'approved' and c.slug = 'cakes'
        limit 1
      `),
      plannedCategoryId: await one(sql`
        select id from app.planning_org_categories where slug = 'cakes'
      `),
      plannedEventItemId: await one(sql`
        select i.id from app.planning_org_event_items i
        join app.planning_org_events e on e.id = i.event_id
        join app.planning_org_categories c on c.id = i.category_id
        where e.name = 'Sarah''s 30th' and c.slug = 'cakes'
      `),
    };

    for (const [key, value] of Object.entries(subjects)) {
      if (!value) throw new Error(`audit fixture did not resolve ${key}`);
    }
  }, 180_000);

  afterAll(async () => {
    // The one fixture row that is not demo data and is not rolled back:
    // categories are reference data, so the demo reseed leaves them alone and
    // this would otherwise accumulate a category per run on whatever database
    // the suite is pointed at.
    await sql?.unsafe(`delete from app.planning_org_categories where slug = 'audit-only'`);
    await database?.close();
    await sql?.end({ timeout: 5 });
  });

  /**
   * Runs one action and reads back the entry it wrote, then rolls both away.
   *
   * Reading inside the transaction is the point: an audit row written outside
   * the change it describes would still be here afterwards, and would survive a
   * rollback that took the change with it.
   */
  /** The person a case runs as, defaulting to the administrator. */
  function performerOf(testCase: Case): Performer {
    if (testCase.actor) return others[testCase.actor];
    return { actor: admin, userId: adminId, actingRole: "admin" };
  }

  async function entryFor(testCase: Case) {
    const rollback = new Rollback();
    const who = performerOf(testCase).actor;
    let entry: typeof auditLog.$inferSelect | undefined;
    let failure: unknown;

    try {
      await ctx.db.transaction(async (tx) => {
        const scoped = { ...ctx, db: tx as unknown as CoreContext["db"] };
        try {
          await testCase.prepare?.(scoped, who, subjects);
          await testCase.run(scoped, who, subjects);
        } catch (error) {
          failure = error;
        }

        [entry] = await (tx as unknown as DbExecutor)
          .select()
          .from(auditLog)
          .where(eq(auditLog.action, testCase.action))
          .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
          .limit(1);

        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }

    // Rethrown so a case that could not run says why, rather than reporting a
    // missing audit entry for an action that never happened.
    if (failure) throw failure instanceof Error ? failure : new Error(JSON.stringify(failure));
    return entry;
  }

  describe.each(CASES)("$screen · $what", (testCase) => {
    it(`writes a ${testCase.action} entry naming who did it`, async () => {
      const who = performerOf(testCase);
      const entry = await entryFor(testCase);

      expect(entry, `no ${testCase.action} entry was written`).toBeDefined();
      expect(entry?.actorUserId).toBe(who.userId);
      // Authority is held, never active: the entry records which hat the person
      // was wearing, which for an admin action is `admin` and for an action
      // somebody took on their own account is whatever they hold.
      expect(entry?.actingRole).toBe(who.actingRole);
      expect(entry?.entityType).toBe(testCase.entityType);
      expect(entry?.after).not.toBeNull();
      if (testCase.entity) expect(entry?.entityId).toBe(subjects[testCase.entity]);
      if (testCase.before) expect(entry?.before).not.toBeNull();
    });
  });

  /**
   * Every audit action the domain can write, read out of its own source.
   *
   * Not out of the log: each case above runs in a transaction that is rolled
   * back, so by the time anything reads `audit_log` it is empty but for what
   * the fixture committed. A completeness check against the log therefore
   * compared one row against a registry of twenty-five and passed — which it
   * would have gone on doing whatever the registry said.
   *
   * The action is not always a literal at the `record()` call: three of them
   * are passed in as an argument (`cancelOrder(…, "order.grace_expired")`) and
   * one is a ternary. So the scan is for the shape of the name rather than for
   * the shape of the call, which is why the prefixes are enumerated — a
   * narrower pattern would miss one and a wider one would match ordinary
   * strings.
   *
   * An unlisted prefix is invisible here, and invisible is worse than absent:
   * the reciprocal check below would still pass, so a whole family of audited
   * actions could arrive with nobody ever reading one of its entries back.
   */
  const ACTION_PATTERN =
    /"((?:order|payment|identity|vendor|ops|email|transfer|quote|dispute|moderation|category|settings|planning|catalog|saved)\.[a-z_.]+)"/g;

  function actionsInSource(): string[] {
    const root = dirname(dirname(fileURLToPath(import.meta.url)));
    const found = new Set<string>();

    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(path);
        } else if (path.endsWith(".ts") && !path.endsWith(".test.ts")) {
          for (const match of readFileSync(path, "utf8").matchAll(ACTION_PATTERN)) {
            found.add(match[1] as string);
          }
        }
      }
    };

    walk(join(root, "src"));
    return [...found].sort();
  }

  /**
   * Actions this suite deliberately leaves to the suite that owns the behaviour.
   *
   * Each names where. An action with no case here and no entry here fails the
   * build, which is the point: a new audited action is a new line in the log
   * that somebody has to have read back at least once.
   */
  const ELSEWHERE: Readonly<Record<string, string>> = {
    "order.create": "payments.test.ts — the checkout",
    "order.cancel": "payments.test.ts — the lifecycle's own cancellation",
    "order.cancel_within_window": "payments.test.ts — the cooling-window refund",
    "order.cancel_refunded": "payments.test.ts — cancelling something already refunded",
    "order.auto_complete": "jobs.test.ts — the runner completing a delivered order",
    "order.raise_issue": "payments.test.ts — the lifecycle move",
    "order.expire_unpaid": "jobs.test.ts — the soft hold's own expiry",
    "order.grace_expired": "jobs.test.ts — the grace window running out",
    "payment.balance_start": "payments.test.ts — the balance charge beginning",
    "payment.balance_captured": "payments.test.ts — a balance that settles",
    "payment.balance_declined": "payments.test.ts — the first decline, which moves the order",
    "payment.deposit_captured": "payments.test.ts — the deposit",
    "payment.refunded_late_capture":
      "payments.test.ts — a charge that settled after its booking was released",
    "transfer.paid": "jobs.test.ts — the payout",
    "transfer.held": "jobs.test.ts — a payout parked for a suspended vendor",
    "quote.expire": "jobs.test.ts — the quote-expiry handler",
    "vendor.connect_onboarding": "payments.test.ts — starting the provider's onboarding",
    "identity.admin.invite.accept": "identity.test.ts — redeeming an invitation",
    "identity.mfa.remove": "identity.test.ts — removing one's own second factor",
    "email.broadcast": "email.test.ts — the send, with its recipient count and template hash",
    "email.consent_withdraw": "email.test.ts — the other direction of the same function",
  };

  it("accounts for every audit action the domain can write", () => {
    const covered = new Set(CASES.map((testCase) => testCase.action));
    const inSource = actionsInSource();

    // A scan that found nothing would make the assertion below vacuous, which
    // is exactly the failure this test replaced.
    expect(inSource.length).toBeGreaterThan(30);

    const unaccounted = inSource.filter((action) => !covered.has(action) && !(action in ELSEWHERE));

    expect(unaccounted).toEqual([]);
  });

  it("keeps the registry and the hand-off list pointed at real actions", () => {
    const inSource = new Set(actionsInSource());
    const claimed = [...CASES.map((testCase) => testCase.action), ...Object.keys(ELSEWHERE)];

    expect(claimed.filter((action) => !inSource.has(action))).toEqual([]);
  });

  it("sees the action families the domain has yet to write", () => {
    // The customer's own screens are next, and none of their actions exists
    // yet. A prefix the pattern does not list is invisible to the scan above,
    // and invisible passes: the first `planning.*` entry would arrive with
    // nothing requiring anybody to have read one back.
    //
    // A copy without the global flag, because `.exec` on the shared one moves
    // its `lastIndex` and the next caller starts mid-file.
    const pattern = new RegExp(ACTION_PATTERN.source);

    for (const action of [
      "planning.event.create",
      "catalog.service.publish",
      "saved.service.add",
    ]) {
      expect([action, pattern.exec(`action: "${action}",`)?.[1]]).toEqual([action, action]);
    }
  });

  describe("money the platform moved by itself", () => {
    it("records the effective time and the administrator who shifted the clock", async () => {
      // The run is the only place this is answerable. An audit entry says the
      // platform charged a card; only `job_runs` can say the platform believed
      // it was a fortnight later because a named person had told it so.
      const effectiveAt = new Date(Date.now() + 40 * 86_400_000);
      await setClockOverride(ctx, admin, effectiveAt);
      database.setDomainNow(effectiveAt);

      const summary = await runDemoJobs(ctx, admin);
      expect(summary.claimed).toBeGreaterThan(0);

      const runs = await ctx.db
        .select()
        .from(jobRuns)
        .where(eq(jobRuns.triggeredBy, "admin_button"))
        .orderBy(desc(jobRuns.startedAt));

      expect(runs.length).toBeGreaterThan(0);
      for (const run of runs) {
        expect(run.clockOverrideActorId).toBe(adminId);
        expect(run.triggeredByUserId).toBe(adminId);
        // The shifted clock is what the run acted on; the wall clock is what it
        // happened at. A row that conflated them could not tell the two apart.
        expect(run.effectiveNow.getTime()).toBeGreaterThan(run.realNow.getTime());
      }

      database.setDomainNow(null);
      await clearClockOverride(ctx, admin);
    }, 60_000);

    it("names nobody's override on a run the timer started", async () => {
      // The other half of the same claim, and the one that makes the first
      // mean something: if every run recorded an override, "which administrator
      // moved the clock" would be answered the same way whether one had or not.
      await runDueJobs(ctx, {
        asOf: new Date(Date.now() + 90 * 86_400_000),
        demoOnly: false,
        trigger: "cron",
      });

      const runs = await ctx.db.select().from(jobRuns).where(eq(jobRuns.triggeredBy, "cron"));

      expect(runs.length).toBeGreaterThan(0);
      for (const run of runs) {
        expect(run.clockOverrideActorId).toBeNull();
        expect(run.triggeredByUserId).toBeNull();
      }
    }, 120_000);
  });
});
