import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type postgres from "postgres";
import { NotFoundError, ValidationError } from "../src/errors.js";
import { getActor } from "../src/identity/service.js";
import { ANONYMOUS, type Actor } from "../src/identity/actor.js";
import type { CoreContext } from "../src/context.js";
import { getPublicService, listPublicServices } from "../src/catalog/service.js";
import {
  approveVendor,
  assertVendorMayBePaid,
  blockVendor,
  getVendorDetail,
  listVendorsForAdmin,
  markUnderReview,
  reinstateVendor,
  suspendVendor,
} from "../src/vendors/service.js";
import { standingHoldReason } from "../src/vendors/transitions.js";
import { createDatabaseContext, ownerSql, resetDatabase, testDatabaseUrl } from "./harness.js";

/**
 * What suspending a vendor actually does, against a real database.
 *
 * The claims here are the ones a fake cannot make honestly: that the status,
 * the held payouts, the held jobs and the session cutoff move in **one**
 * transaction; that a job is found through the order id buried in its JSON
 * payload; and that a suspended vendor's services stop being listable. Each is
 * a row that either is or is not there afterwards.
 */

const url = testDatabaseUrl();

describe.skipIf(!url)("vendor standing", () => {
  const dbUrl = url as string;
  let sql: postgres.Sql;
  let database: ReturnType<typeof createDatabaseContext>;
  let ctx: CoreContext;
  let admin: Actor;

  const vendorIds: Record<string, string> = {};

  beforeAll(async () => {
    await resetDatabase(dbUrl);
    sql = ownerSql(dbUrl);
    database = createDatabaseContext(dbUrl);
    ctx = database.ctx;

    database.setUser({
      id: "provider-sub-admin@occasion.test",
      email: "admin@occasion.test",
      issuedAt: new Date(),
      emailVerified: true,
      secondFactorVerified: true,
    });
    admin = await getActor(ctx, {});

    const rows = await sql<{ id: string; name: string }[]>`
      select id, name from app.planning_org_vendors
    `;
    for (const row of rows) vendorIds[row.name] = row.id;
  }, 120_000);

  afterAll(async () => {
    await database?.close();
    await sql?.end({ timeout: 5 });
  });

  /**
   * Back to the seeded state before each test.
   *
   * These tests move money and sessions, so one leaving a vendor suspended
   * would make the next one's failure a puzzle rather than a result.
   */
  beforeEach(async () => {
    await resetDatabase(dbUrl);
  }, 120_000);

  const idOf = (name: string): string => vendorIds[name] as string;

  describe("the queue", () => {
    it("shows every vendor, with the prototype's distinctive states intact", async () => {
      const list = await listVendorsForAdmin(ctx, admin);

      // The prototype draws six rows; the platform has more, because the
      // catalogue's vendors are real businesses too. What has to hold is the
      // shape of the work: two applications waiting, one refused.
      expect(list.counts.pending).toBe(2);
      expect(list.counts.blocked).toBe(1);
      expect(list.counts.suspended).toBe(0);

      const pending = list.rows.filter((row) => row.status === "pending").map((row) => row.name);
      expect(pending.sort()).toEqual(["Kimchi Kart", "The Bloor Quartet"]);

      const blocked = list.rows.filter((row) => row.status === "blocked").map((row) => row.name);
      expect(blocked).toEqual(["Terrace Rentals"]);
    });

    it("writes the prototype's detail line", async () => {
      const list = await listVendorsForAdmin(ctx, admin);
      const bloom = list.rows.find((row) => row.name === "Bloom & Co");
      const terrace = list.rows.find((row) => row.name === "Terrace Rentals");

      // design/Event Marketplace Glass.dc.html:2715 and :2718.
      expect(bloom?.detail).toBe("Flowers · Liberty Village · Stripe test connected");
      expect(terrace?.detail).toBe("Decorations · Etobicoke · onboarding incomplete");
    });

    it("filters by status and searches by name, category and area", async () => {
      const pendingOnly = await listVendorsForAdmin(ctx, admin, { status: "pending" });
      expect(pendingOnly.rows.map((row) => row.name).sort()).toEqual([
        "Kimchi Kart",
        "The Bloor Quartet",
      ]);
      // The counts are of every vendor, not of the filtered rows: the chips
      // have to keep saying how much work each pile holds while one is open.
      expect(pendingOnly.counts.approved).toBeGreaterThan(0);

      const byName = await listVendorsForAdmin(ctx, admin, { search: "kimchi" });
      expect(byName.rows.map((row) => row.name)).toEqual(["Kimchi Kart"]);

      const byCategory = await listVendorsForAdmin(ctx, admin, { search: "Flowers" });
      expect(byCategory.rows.map((row) => row.name).sort()).toEqual([
        "Bloom & Co",
        "Wildwood Florals",
      ]);

      const byArea = await listVendorsForAdmin(ctx, admin, { search: "Etobicoke" });
      expect(byArea.rows.map((row) => row.name)).toEqual(["Terrace Rentals"]);
    });

    it("treats a wildcard in the search term as text", async () => {
      // Without escaping, `%` is pattern syntax and this matches everything.
      const list = await listVendorsForAdmin(ctx, admin, { search: "%" });
      expect(list.rows).toHaveLength(0);
    });
  });

  describe("approving", () => {
    it("flips the badge, persists, and writes an audit row naming the admin and role", async () => {
      const kimchi = idOf("Kimchi Kart");
      const change = await approveVendor(ctx, admin, kimchi);

      expect(change.from).toBe("pending");
      expect(change.to).toBe("approved");

      const [row] = await sql<{ status: string; approved_at: Date | null }[]>`
        select status, approved_at from app.planning_org_vendors where id = ${kimchi}
      `;
      expect(row?.status).toBe("approved");
      expect(row?.approved_at).not.toBeNull();

      const [entry] = await sql<
        { action: string; acting_role: string; actor_user_id: string; before: unknown }[]
      >`
        select action, acting_role, actor_user_id, before
        from app.planning_org_audit_log
        where entity_type = 'vendor' and entity_id = ${kimchi}
        order by created_at desc limit 1
      `;
      expect(entry?.action).toBe("vendor.approve");
      expect(entry?.acting_role).toBe("admin");
      expect(entry?.actor_user_id).toBe(
        admin.kind === "user" ? admin.userId : "the actor should be a user",
      );
      expect(entry?.before).toEqual({ status: "pending" });
    });

    it("refuses an invalid transition in the service, not just in the UI", async () => {
      const bloom = idOf("Bloom & Co");

      // Already approved. A second tab showing a stale row is the ordinary way
      // this is reached, so it has to be refused rather than made idempotent.
      await expect(approveVendor(ctx, admin, bloom)).rejects.toBeInstanceOf(ValidationError);

      // approved → pending is not a move at all.
      await expect(markUnderReview(ctx, admin, bloom)).rejects.toBeInstanceOf(ValidationError);

      const [row] = await sql<{ status: string }[]>`
        select status from app.planning_org_vendors where id = ${bloom}
      `;
      expect(row?.status).toBe("approved");
    });

    it("answers 'no such vendor' for an id that is not one", async () => {
      await expect(
        approveVendor(ctx, admin, "00000000-0000-4000-8000-000000000000"),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("answers the same for text that is not an id at all", async () => {
      // Both arrive the same way — a query parameter or a form field someone
      // can type. Letting this one reach the driver turns a wrong guess into
      // an error page instead of an empty result.
      for (const notAnId of ["", "abc", "1; drop table x", "00000000-0000-4000-8000"]) {
        await expect(approveVendor(ctx, admin, notAnId)).rejects.toBeInstanceOf(NotFoundError);
        await expect(getVendorDetail(ctx, admin, notAnId)).rejects.toBeInstanceOf(NotFoundError);
      }
    });

    it("requires a reason for the two moves that take something away", async () => {
      await expect(suspendVendor(ctx, admin, idOf("Bloom & Co"), "   ")).rejects.toBeInstanceOf(
        ValidationError,
      );
      await expect(blockVendor(ctx, admin, idOf("Kimchi Kart"), "")).rejects.toBeInstanceOf(
        ValidationError,
      );
    });
  });

  describe("suspending stops money that is already scheduled", () => {
    it("parks a queued deposit-transfer job as held", async () => {
      const bloom = idOf("Bloom & Co");

      const before = await sql<{ id: string; status: string }[]>`
        select j.id, j.status
        from app.planning_org_jobs j
        join app.planning_org_orders o on o.id = (j.payload->>'orderId')::uuid
        where j.type = 'cooling_window_transfer' and o.vendor_id = ${bloom}
      `;
      // The seed leaves exactly one of these queued, which is what makes this
      // assertion worth making rather than vacuous.
      expect(before.length).toBeGreaterThan(0);
      expect(before.every((job) => job.status === "queued")).toBe(true);

      const change = await suspendVendor(ctx, admin, bloom, "Chargebacks under investigation");
      expect(change.heldJobs).toBe(before.length);

      const after = await sql<{ status: string; held_reason: string }[]>`
        select status, held_reason from app.planning_org_jobs
        where id in ${sql(before.map((job) => job.id))}
      `;
      expect(after.every((job) => job.status === "held")).toBe(true);
      expect(after[0]?.held_reason).toContain("Chargebacks under investigation");
    });

    it("parks a failed transfer too — it is a retry waiting, not settled money", async () => {
      const bloom = idOf("Bloom & Co");
      const moved = await sql`
        update app.planning_org_transfers
        set state = 'failed', paid_at = null, provider_transfer_id = null
        where vendor_id = ${bloom}
        returning id
      `;
      expect(moved.length).toBeGreaterThan(0);

      const change = await suspendVendor(ctx, admin, bloom, "Chargebacks");
      expect(change.heldTransfers).toBe(moved.length);

      const after = await sql<{ state: string }[]>`
        select state from app.planning_org_transfers where vendor_id = ${bloom}
      `;
      expect(after.every((transfer) => transfer.state === "held")).toBe(true);
    });

    it("survives a job whose payload names something that is not an id", async () => {
      const bloom = idOf("Bloom & Co");

      // One row like this used to abort the UPDATE, and because that UPDATE is
      // inside the suspension's transaction it would make every suspension of
      // every vendor fail — not only this vendor's.
      await sql`
        update app.planning_org_jobs
        set payload = jsonb_set(payload, '{orderId}', '"TO-4192"')
        where type = 'expire_quote_request'
      `;

      await expect(suspendVendor(ctx, admin, bloom, "Chargebacks")).resolves.toBeDefined();
      await expect(getVendorDetail(ctx, admin, bloom)).resolves.toBeDefined();
    });

    it("parks a pending transfer row as held, and leaves a paid one alone", async () => {
      const bloom = idOf("Bloom & Co");

      // The seed's transfers are all settled, so the pending case is made here
      // rather than assumed: this is the row a cooling window has just closed
      // on, waiting for the runner. Not every order has one — only the ones
      // whose window has closed — so the update is by vendor, not by order.
      const moved = await sql`
        update app.planning_org_transfers
        set state = 'pending', paid_at = null, provider_transfer_id = null
        where vendor_id = ${bloom}
        returning id
      `;
      expect(moved.length).toBeGreaterThan(0);

      const paidElsewhere = await sql<{ id: string }[]>`
        select t.id from app.planning_org_transfers t
        where t.state = 'paid' and t.vendor_id <> ${bloom} limit 1
      `;

      const change = await suspendVendor(ctx, admin, bloom, "Chargebacks");
      expect(change.heldTransfers).toBeGreaterThan(0);

      const held = await sql<{ state: string; held_reason: string }[]>`
        select state, held_reason from app.planning_org_transfers where vendor_id = ${bloom}
      `;
      expect(held.some((transfer) => transfer.state === "held")).toBe(true);

      // Money that has already left cannot be recalled by an update, so it must
      // not be rewritten to say it is on hold.
      if (paidElsewhere[0]) {
        const [untouched] = await sql<{ state: string }[]>`
          select state from app.planning_org_transfers where id = ${paidElsewhere[0].id}
        `;
        expect(untouched?.state).toBe("paid");
      }
    });

    it("refuses a payout to a suspended vendor however it is attempted", async () => {
      const bloom = idOf("Bloom & Co");

      // Called the way a payout must call it: inside the transaction that would
      // make the payment, so the row lock it takes is still held when the money
      // moves. On the pool handle the lock would be released immediately and a
      // suspension could commit between this check and the provider call.
      await expect(
        ctx.db.transaction((tx) => assertVendorMayBePaid(tx, bloom)),
      ).resolves.toBeUndefined();

      await suspendVendor(ctx, admin, bloom, "Chargebacks");

      // A job that was already running, or a retry that outlived the
      // suspension, still cannot pay them.
      await expect(
        ctx.db.transaction((tx) => assertVendorMayBePaid(tx, bloom)),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("makes a suspension wait for a payout that is already in flight", async () => {
      const bloom = idOf("Bloom & Co");

      // Two transactions, the way the runner and an administrator would race.
      // The payout takes the lock first; the suspension must not slip past it.
      let settled = false;
      let suspending: Promise<unknown> | undefined;

      await ctx.db.transaction(async (tx) => {
        await assertVendorMayBePaid(tx, bloom);

        suspending = suspendVendor(ctx, admin, bloom, "Chargebacks").finally(() => {
          settled = true;
        });

        // Long enough that a suspension which was not blocked would have
        // committed by now. Awaited *outside* this callback, because the lock
        // it is waiting on is not released until this transaction commits.
        await new Promise((resolve) => setTimeout(resolve, 500));
        expect(settled).toBe(false);
      });

      await suspending;
      expect(settled).toBe(true);
    });

    it("ends the sessions of every vendor member", async () => {
      const bloom = idOf("Bloom & Co");
      const before = await sql<{ id: string; sessions_valid_after: Date }[]>`
        select u.id, u.sessions_valid_after
        from app.planning_org_users u
        join app.planning_org_vendor_members m on m.user_id = u.id
        where m.vendor_id = ${bloom}
      `;
      expect(before.length).toBeGreaterThan(0);

      const change = await suspendVendor(ctx, admin, bloom, "Chargebacks");
      expect(change.endedSessions).toBe(before.length);

      const after = await sql<{ id: string; sessions_valid_after: Date }[]>`
        select id, sessions_valid_after from app.planning_org_users
        where id in ${sql(before.map((row) => row.id))}
      `;
      for (const row of after) {
        const was = before.find((entry) => entry.id === row.id);
        expect(row.sessions_valid_after.getTime()).toBeGreaterThan(
          was?.sessions_valid_after.getTime() ?? 0,
        );
      }
    });

    it("signs staff out even when the demo clock has been moved backwards", async () => {
      const bloom = idOf("Bloom & Co");
      const [owner] = await sql<{ id: string; email: string }[]>`
        select u.id, u.email from app.planning_org_users u
        join app.planning_org_vendor_members m on m.user_id = u.id
        where m.vendor_id = ${bloom} limit 1
      `;

      // An administrator demonstrating the platform with the clock set to last
      // week. The cutoff is compared against a token issue time the auth
      // provider stamped in real time, so a cutoff written from the shifted
      // clock would sit in the past and refuse nobody.
      const lastWeek = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      database.setDomainNow(lastWeek);
      try {
        await suspendVendor(ctx, admin, bloom, "Chargebacks");
      } finally {
        database.setDomainNow(null);
      }

      const [after] = await sql<{ sessions_valid_after: Date }[]>`
        select sessions_valid_after from app.planning_org_users where id = ${owner?.id ?? null}
      `;
      const cutoff = after?.sessions_valid_after as Date;

      expect(cutoff.getTime()).toBeGreaterThan(lastWeek.getTime());
      // A token minted a moment ago must not survive it.
      expect(cutoff.getTime()).toBeGreaterThan(Date.now() - 60_000);
    });

    it("never lowers a cutoff an earlier revocation raised", async () => {
      const bloom = idOf("Bloom & Co");
      const [owner] = await sql<{ id: string }[]>`
        select u.id from app.planning_org_users u
        join app.planning_org_vendor_members m on m.user_id = u.id
        where m.vendor_id = ${bloom} limit 1
      `;

      // Somebody was locked out until an hour from now — a revocation that has
      // already happened. Suspending the vendor must not hand those sessions
      // back by writing an earlier instant over it.
      const inAnHour = new Date(Date.now() + 60 * 60 * 1000);
      await sql`
        update app.planning_org_users set sessions_valid_after = ${inAnHour}
        where id = ${owner?.id ?? null}
      `;

      await suspendVendor(ctx, admin, bloom, "Chargebacks");

      const [after] = await sql<{ sessions_valid_after: Date }[]>`
        select sessions_valid_after from app.planning_org_users where id = ${owner?.id ?? null}
      `;
      expect(after?.sessions_valid_after.getTime()).toBe(inAnHour.getTime());
    });

    it("makes a session issued before the suspension anonymous on the next request", async () => {
      const bloom = idOf("Bloom & Co");
      const [owner] = await sql<{ email: string }[]>`
        select u.email from app.planning_org_users u
        join app.planning_org_vendor_members m on m.user_id = u.id
        where m.vendor_id = ${bloom} limit 1
      `;
      const email = owner?.email as string;

      // Bind the provider subject the way a first sign-in would, so the actor
      // resolves to the seeded row.
      await sql`
        update app.planning_org_users set auth_provider_sub = ${`provider-sub-${email}`}
        where email = ${email}
      `;

      // Issued now. The seed writes `sessions_valid_after` at seed time, so a
      // token backdated even a minute is already refused and the test would
      // prove nothing about suspension.
      const issuedAt = new Date();
      database.setUser({
        id: `provider-sub-${email}`,
        email,
        issuedAt,
        emailVerified: true,
        secondFactorVerified: true,
      });

      const before = await getActor(ctx, {});
      expect(before.kind).toBe("user");

      database.setUser({
        id: "provider-sub-admin@occasion.test",
        email: "admin@occasion.test",
        issuedAt: new Date(),
        emailVerified: true,
        secondFactorVerified: true,
      });
      await suspendVendor(ctx, admin, bloom, "Chargebacks");

      database.setUser({
        id: `provider-sub-${email}`,
        email,
        issuedAt,
        emailVerified: true,
        secondFactorVerified: true,
      });
      const after = await getActor(ctx, {});
      expect(after.kind).toBe("anonymous");
    });

    it("does all of it or none of it", async () => {
      const bloom = idOf("Bloom & Co");

      // Make the second write of the transaction fail. If the status change and
      // the payout hold are not one unit, this leaves a suspended vendor whose
      // queued payout is still going to run — which is the exact failure the
      // transaction exists to prevent.
      await sql`
        create or replace function app.fail_job_hold() returns trigger as $$
        begin raise exception 'job hold refused, on purpose'; end;
        $$ language plpgsql
      `;
      await sql`
        create trigger fail_job_hold before update on app.planning_org_jobs
        for each row when (new.status = 'held') execute function app.fail_job_hold()
      `;

      try {
        // Drizzle wraps the driver error, so the trigger's own message is the
        // cause rather than the message.
        await expect(suspendVendor(ctx, admin, bloom, "Chargebacks")).rejects.toThrow();
      } finally {
        await sql`drop trigger fail_job_hold on app.planning_org_jobs`;
        await sql`drop function app.fail_job_hold()`;
      }

      // Nothing survived: not the status, not the audit row.
      const [status] = await sql<{ status: string }[]>`
        select status from app.planning_org_vendors where id = ${bloom}
      `;
      const entries = await sql<{ action: string }[]>`
        select action from app.planning_org_audit_log
        where entity_type = 'vendor' and entity_id = ${bloom}
      `;
      expect(status?.status).toBe("approved");
      expect(entries).toHaveLength(0);

      // And it still works once the obstacle is gone.
      await expect(suspendVendor(ctx, admin, bloom, "Chargebacks")).resolves.toBeDefined();
    });
  });

  describe("reinstating", () => {
    it("releases what the suspension parked, and nothing else", async () => {
      const bloom = idOf("Bloom & Co");

      await sql`
        update app.planning_org_transfers set state = 'pending', paid_at = null,
          provider_transfer_id = null
        where vendor_id = ${bloom}
      `;

      await suspendVendor(ctx, admin, bloom, "Chargebacks");

      // A hold somebody else put on, for a different reason. Approving the
      // business must not pay this one out.
      await sql`
        update app.planning_org_jobs set status = 'held', held_reason = 'Dispute DS-1'
        where type = 'charge_balance' and status = 'queued'
      `;

      const change = await reinstateVendor(ctx, admin, bloom);
      expect(change.releasedJobs).toBeGreaterThan(0);
      expect(change.releasedTransfers).toBeGreaterThan(0);

      const stillHeld = await sql<{ held_reason: string }[]>`
        select held_reason from app.planning_org_jobs where status = 'held'
      `;
      expect(stillHeld.every((job) => job.held_reason === "Dispute DS-1")).toBe(true);
    });

    it("releases a hold the seed wrote, not only one this code wrote", async () => {
      // The seed holds a payout for a vendor who is already suspended or
      // blocked. It has to phrase that hold the same way, or reinstating the
      // vendor leaves the money parked for ever with nothing able to free it.
      const bloom = idOf("Bloom & Co");
      await sql`
        update app.planning_org_transfers
        set state = 'held', held_reason = ${standingHoldReason("suspended")}
        where vendor_id = ${bloom}
      `;
      await sql`update app.planning_org_vendors set status = 'suspended' where id = ${bloom}`;

      const change = await reinstateVendor(ctx, admin, bloom);
      expect(change.releasedTransfers).toBeGreaterThan(0);
    });
  });

  describe("public listability", () => {
    it("drops a vendor's services the moment they are suspended", async () => {
      const bloom = idOf("Bloom & Co");

      const before = await listPublicServices(ctx, ANONYMOUS);
      const theirs = before.filter((service) => service.vendorId === bloom);
      expect(theirs.length).toBeGreaterThan(0);
      const slug = theirs[0]!.slug;

      await expect(getPublicService(ctx, ANONYMOUS, slug)).resolves.toBeDefined();

      await suspendVendor(ctx, admin, bloom, "Chargebacks");

      const after = await listPublicServices(ctx, ANONYMOUS);
      expect(after.filter((service) => service.vendorId === bloom)).toHaveLength(0);

      // The same answer as a slug that never existed: a suspended business's
      // page must not become a way to learn it was suspended.
      await expect(getPublicService(ctx, ANONYMOUS, slug)).rejects.toBeInstanceOf(NotFoundError);
    });

    it("never lists a pending or blocked vendor", async () => {
      const listed = await listPublicServices(ctx, ANONYMOUS);
      const statuses = await sql<{ id: string; status: string }[]>`
        select id, status from app.planning_org_vendors
      `;
      const notApproved = new Set(
        statuses.filter((row) => row.status !== "approved").map((row) => row.id),
      );

      expect(listed.some((service) => notApproved.has(service.vendorId))).toBe(false);
    });
  });

  describe("the detail record", () => {
    it("carries members, the onboarding checklist and what is held", async () => {
      const terrace = idOf("Terrace Rentals");
      const detail = await getVendorDetail(ctx, admin, terrace);

      expect(detail.vendor.status).toBe("blocked");
      expect(detail.members.length).toBeGreaterThan(0);

      const steps = Object.fromEntries(detail.onboarding.map((step) => [step.id, step.done]));
      expect(steps["profile"]).toBe(true);
      // No connected account, which is why this vendor is blocked.
      expect(steps["payouts"]).toBe(false);
      expect(detail.stripe.mode).toBe("test");
    });

    it("shows the held payouts after a suspension", async () => {
      const bloom = idOf("Bloom & Co");
      await suspendVendor(ctx, admin, bloom, "Chargebacks");

      const detail = await getVendorDetail(ctx, admin, bloom);
      expect(detail.heldJobs.length).toBeGreaterThan(0);
      expect(detail.suspension.reason).toBe("Chargebacks");
      expect(detail.history[0]?.action).toBe("vendor.suspend");
    });
  });
});
