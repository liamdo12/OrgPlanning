import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@occasion/db/schema";
import {
  ForbiddenError,
  NotFoundError,
  UnauthenticatedError,
  ValidationError,
} from "../src/errors.js";
import type { Actor } from "../src/identity/actor.js";
import type { CoreContext } from "../src/context.js";
import { getActor } from "../src/identity/service.js";
import {
  approveUser,
  getUserDetail,
  grantRoleToUser,
  listUsersForAdmin,
  reinstateAccount,
  resendVerification,
  revokeRoleFromUser,
  suspendAccount,
} from "../src/identity/admin-service.js";
import { countActiveAdmins, loadForAdmin } from "../src/identity/admin-repo.js";
import { createDatabaseContext, ownerSql, resetDatabase, testDatabaseUrl } from "./harness.js";

/**
 * The account list, against a real database.
 *
 * The claims worth making here are the ones a fake cannot make: that the
 * activity figures survive being joined to two other tables, that a filter
 * returns the person it is supposed to, that a revocation reaches a route that
 * has nothing to do with the admin screen, and that the platform cannot be left
 * with nobody who can administer it.
 */

const url = testDatabaseUrl();

describe.skipIf(!url)("admin users", () => {
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

  function signInAs(email: string, issuedAt: Date = new Date()): void {
    database.setUser({
      id: `provider-sub-${email}`,
      email,
      issuedAt,
      emailVerified: true,
      secondFactorVerified: true,
    });
  }

  /** Binds a provider subject the way a first sign-in would. */
  async function bind(email: string): Promise<void> {
    await sql`
      update app.planning_org_users set auth_provider_sub = ${`provider-sub-${email}`}
      where email = ${email}
    `;
  }

  const idOf = (email: string): string => ids[email] as string;

  describe("who may read the list at all", () => {
    it("refuses anyone who is not an administrator", async () => {
      await bind("sarah@example.ca");
      signInAs("sarah@example.ca");
      const customer = await getActor(ctx, {});

      await expect(listUsersForAdmin(ctx, customer)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        getUserDetail(ctx, customer, idOf("ada.okafor@example.ca")),
      ).rejects.toBeInstanceOf(ForbiddenError);

      database.setUser(null);
      const anonymous = await getActor(ctx, {});
      await expect(listUsersForAdmin(ctx, anonymous)).rejects.toBeInstanceOf(
        UnauthenticatedError,
      );
    });

    it("refuses a suspended administrator", async () => {
      // The role alone is not enough: an account that has been suspended keeps
      // its role row, and `requireUser` is what stops it being usable.
      await sql`
        update app.planning_org_users set status = 'suspended', auth_provider_sub = ${"provider-sub-admin@occasion.test"}
        where email = 'admin@occasion.test'
      `;
      signInAs("admin@occasion.test");
      const suspended = await getActor(ctx, {});

      await expect(listUsersForAdmin(ctx, suspended)).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  describe("the four filters", () => {
    it("returns the prototype's four sets, none of them empty", async () => {
      const all = await listUsersForAdmin(ctx, admin, { filter: "all" });
      const customers = await listUsersForAdmin(ctx, admin, { filter: "customers" });
      const staff = await listUsersForAdmin(ctx, admin, { filter: "vendor-staff" });
      const suspended = await listUsersForAdmin(ctx, admin, { filter: "suspended" });

      expect(all.total).toBe(7);
      expect(customers.rows.map((row) => row.fullName).sort()).toEqual([
        "Ada Okafor",
        "Jonah Tran",
        "Sarah Mensah",
      ]);
      expect(staff.rows.map((row) => row.fullName).sort()).toEqual([
        "Bea Varga",
        "Dae Kim",
        "Rosa Lam",
      ]);
      // The one the plan calls out: this filter used to be capable of
      // returning nothing at all and looking correct.
      expect(suspended.rows.map((row) => row.fullName)).toEqual(["Bea Varga"]);
    });

    it("shows all four statuses, each with the action the prototype gives it", async () => {
      const all = await listUsersForAdmin(ctx, admin, { filter: "all" });
      const byName = new Map(all.rows.map((row) => [row.fullName, row]));

      // Source: lines 2629–2634.
      expect(byName.get("Sarah Mensah")?.status).toBe("active");
      expect(byName.get("Sarah Mensah")?.action).toBe("suspend");
      expect(byName.get("Dae Kim")?.status).toBe("pending");
      expect(byName.get("Dae Kim")?.action).toBe("approve");
      expect(byName.get("Jonah Tran")?.status).toBe("unverified");
      expect(byName.get("Jonah Tran")?.action).toBe("resend-verification");
      expect(byName.get("Bea Varga")?.status).toBe("suspended");
      expect(byName.get("Bea Varga")?.action).toBe("reinstate");
    });

    it("falls back to the first page for a cursor that is not one", async () => {
      // Hand-edited, truncated, or a stale link. The tail is compared against a
      // uuid column, and Postgres raises on a malformed one rather than
      // matching nothing — so an unchecked cursor is an error page.
      for (const junk of ["x:abc", "no-separator", "Name:", "Name:not-a-uuid"]) {
        const page = await listUsersForAdmin(ctx, admin, { cursor: junk });
        expect(page.rows.length).toBeGreaterThan(0);
        expect(page.rows[0]?.fullName).toBe("Ada Okafor");
      }
    });

    it("searches the name and the address, and treats a wildcard as text", async () => {
      const byName = await listUsersForAdmin(ctx, admin, { search: "varga" });
      expect(byName.rows.map((row) => row.fullName)).toEqual(["Bea Varga"]);

      const byEmail = await listUsersForAdmin(ctx, admin, { search: "kimchikart" });
      expect(byEmail.rows.map((row) => row.fullName)).toEqual(["Dae Kim"]);

      const wildcard = await listUsersForAdmin(ctx, admin, { search: "%" });
      expect(wildcard.rows).toHaveLength(0);
    });
  });

  describe("the activity line", () => {
    it("matches a hand-computed total for each seeded customer", async () => {
      const list = await listUsersForAdmin(ctx, admin, { filter: "customers" });

      for (const email of ["sarah@example.ca", "ada.okafor@example.ca"]) {
        const [expected] = await sql<{ events: number; orders: number; spend: string }[]>`
          select
            (select count(*) from app.planning_org_events e where e.owner_user_id = u.id) as events,
            (select count(*) from app.planning_org_orders o where o.user_id = u.id) as orders,
            (select coalesce(sum(o.total), 0) from app.planning_org_orders o where o.user_id = u.id)
              as spend
          from app.planning_org_users u where u.email = ${email}
        `;

        const row = list.rows.find((entry) => entry.email === email);
        const money = new Intl.NumberFormat("en-CA", {
          style: "currency",
          currency: "CAD",
          currencyDisplay: "narrowSymbol",
        })
          .format(Number(expected?.spend ?? 0) / 100)
          .replace("$", "C$");

        expect(row?.activity).toBe(
          `${expected?.events} events · ${expected?.orders} orders · ${money}`,
        );
      }
    });

    it("does not multiply the spend by the number of events", async () => {
      // The failure the query's shape exists to prevent, asserted against the
      // aggregate itself rather than against a list that cannot fan out.
      const sarah = idOf("sarah@example.ca");
      const [truth] = await sql<{ spend: string; events: string }[]>`
        select
          (select coalesce(sum(total), 0) from app.planning_org_orders where user_id = ${sarah})
            as spend,
          (select count(*) from app.planning_org_events where owner_user_id = ${sarah}) as events
      `;

      // Only meaningful while this person has more than one of each: with one
      // event the multiplied answer and the right one are the same number.
      expect(Number(truth?.events)).toBeGreaterThan(1);

      const row = await loadForAdmin(ctx, sarah);
      expect(row?.totalSpend).toBe(BigInt(truth?.spend ?? 0));
      expect(row?.eventCount).toBe(Number(truth?.events));
    });

    it("hands back cents as a bigint, not a string wearing its type", async () => {
      // `sum(bigint)` is `numeric`, and a raw fragment carries no mapping, so
      // this is a string unless it is told otherwise — and the first caller to
      // do `> 0n` on it would throw.
      const row = await loadForAdmin(ctx, idOf("sarah@example.ca"));
      expect(typeof row?.totalSpend).toBe("bigint");
      expect(row!.totalSpend > 0n).toBe(true);
    });

    it("describes vendor staff by their business rather than by spend", async () => {
      const staff = await listUsersForAdmin(ctx, admin, { filter: "vendor-staff" });
      const rosa = staff.rows.find((row) => row.fullName === "Rosa Lam");
      const dae = staff.rows.find((row) => row.fullName === "Dae Kim");

      // Source: lines 2631 and 2632.
      expect(rosa?.activity).toBe("Bloom & Co · owner · payouts enabled");
      expect(rosa?.roleLabel).toBe("Vendor staff");
      expect(dae?.activity).toBe("Kimchi Kart · owner · onboarding 80%");
    });

    it("labels the administrator, whom the prototype never shows", async () => {
      const all = await listUsersForAdmin(ctx, admin, { filter: "all" });
      const row = all.rows.find((entry) => entry.email === "admin@occasion.test");
      expect(row?.roleLabel).toBe("Administrator");
    });
  });

  describe("pagination", () => {
    it("walks a thousand accounts a page at a time, without an N+1", async () => {
      await sql`
        insert into app.planning_org_users (email, full_name, status, is_demo)
        select 'bulk-' || i || '@example.ca', 'Bulk Person ' || lpad(i::text, 4, '0'), 'active', true
        from generate_series(1, 1000) as i
      `;

      const first = await listUsersForAdmin(ctx, admin, { filter: "all" });
      expect(first.rows).toHaveLength(25);
      expect(first.total).toBe(1007);
      expect(first.nextCursor).toBeDefined();

      const second = await listUsersForAdmin(ctx, admin, {
        filter: "all",
        ...(first.nextCursor ? { cursor: first.nextCursor } : {}),
      });
      expect(second.rows).toHaveLength(25);

      // No overlap and no gap: the cursor is on (name, id), so a page boundary
      // cannot repeat or skip somebody.
      const firstIds = new Set(first.rows.map((row) => row.id));
      expect(second.rows.some((row) => firstIds.has(row.id))).toBe(false);

      const names = [...first.rows, ...second.rows].map((row) => row.fullName);
      expect(names).toEqual([...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    });

    it("is two queries per page however many accounts there are", async () => {
      await sql`
        insert into app.planning_org_users (email, full_name, status, is_demo)
        select 'bulk-' || i || '@example.ca', 'Bulk Person ' || lpad(i::text, 4, '0'), 'active', true
        from generate_series(1, 200) as i
      `;

      // Counted at the driver, because the database's own statement statistics
      // are an extension this stack does not load — and a count read from a
      // table that does not exist is a test that passes without asserting
      // anything.
      let executed = 0;
      const counting = postgres(dbUrl, {
        max: 2,
        prepare: false,
        onnotice: () => {},
        debug: () => {
          executed += 1;
        },
      });

      try {
        const countingCtx: CoreContext = { ...ctx, db: drizzle(counting, { schema }) };

        // Open the connection first and only then start counting: the driver
        // issues its own setup statement on first use, and counting that would
        // make the assertion about postgres.js rather than about this query.
        await counting`select 1`;
        executed = 0;

        await listUsersForAdmin(countingCtx, admin, { filter: "all" });
      } finally {
        await counting.end({ timeout: 5 });
      }

      // The count and the page, and nothing per row — which is the whole point
      // of aggregating each dimension before it is joined.
      expect(executed).toBe(2);
    });
  });

  describe("suspension reaches every route", () => {
    it("makes the account anonymous on the next request, admin route or not", async () => {
      const email = "sarah@example.ca";
      await bind(email);

      const issuedAt = new Date();
      signInAs(email, issuedAt);
      expect((await getActor(ctx, {})).kind).toBe("user");

      signInAs("admin@occasion.test");
      await suspendAccount(ctx, admin, idOf(email), "Chargebacks");

      // `getActor` is what every route builds its actor from — there is no
      // separate check on admin routes for this to be scoped to.
      signInAs(email, issuedAt);
      expect((await getActor(ctx, {})).kind).toBe("anonymous");

      // And a token minted after the suspension still gets a suspended account,
      // which `requireUser` refuses everywhere.
      signInAs(email, new Date(Date.now() + 1000));
      const actor = await getActor(ctx, {});
      expect(actor.kind === "user" && actor.status).toBe("suspended");
    });

    it("requires a reason", async () => {
      await expect(
        suspendAccount(ctx, admin, idOf("sarah@example.ca"), "   "),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("reinstates, and moves the cutoff forward", async () => {
      const bea = idOf("bea@terracerentals.ca");

      // Forced into the past first. The seeded cutoff is anchor-relative and
      // can already be later than now, which would make a `>=` assertion pass
      // whether or not the code wrote anything.
      const longAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      await sql`
        update app.planning_org_users set sessions_valid_after = ${longAgo} where id = ${bea}
      `;

      await reinstateAccount(ctx, admin, bea);

      const [after] = await sql<{ status: string; sessions_valid_after: Date }[]>`
        select status, sessions_valid_after from app.planning_org_users where id = ${bea}
      `;
      expect(after?.status).toBe("active");
      expect(after?.sessions_valid_after.getTime()).toBeGreaterThan(longAgo.getTime());
    });

    it("never lowers a cutoff a previous revocation raised", async () => {
      const bea = idOf("bea@terracerentals.ca");
      const ahead = new Date(Date.now() + 60 * 60 * 1000);
      await sql`
        update app.planning_org_users set sessions_valid_after = ${ahead} where id = ${bea}
      `;

      await reinstateAccount(ctx, admin, bea);

      const [after] = await sql<{ sessions_valid_after: Date }[]>`
        select sessions_valid_after from app.planning_org_users where id = ${bea}
      `;
      expect(after?.sessions_valid_after.getTime()).toBe(ahead.getTime());
    });
  });

  describe("roles", () => {
    it("takes effect on the next request even with an unexpired token", async () => {
      const email = "rosa@bloomandco.ca";
      await bind(email);

      const issuedAt = new Date();
      signInAs(email, issuedAt);
      const before = await getActor(ctx, {});
      expect(before.kind === "user" && before.roles).toContain("vendor");

      signInAs("admin@occasion.test");
      await revokeRoleFromUser(ctx, admin, idOf(email), "vendor");

      // The same token. The role is read from the database on every request, so
      // it is already gone — and the cutoff moved, so this session is refused
      // outright rather than merely losing one role.
      signInAs(email, issuedAt);
      expect((await getActor(ctx, {})).kind).toBe("anonymous");

      signInAs(email, new Date(Date.now() + 1000));
      const after = await getActor(ctx, {});
      expect(after.kind === "user" && after.roles).not.toContain("vendor");
    });

    it("demands the account's address before granting admin", async () => {
      const sarah = idOf("sarah@example.ca");

      await expect(grantRoleToUser(ctx, admin, sarah, "admin")).rejects.toBeInstanceOf(
        ValidationError,
      );
      await expect(
        grantRoleToUser(ctx, admin, sarah, "admin", "not-the-address"),
      ).rejects.toBeInstanceOf(ValidationError);

      await expect(
        grantRoleToUser(ctx, admin, sarah, "admin", "Sarah@Example.CA"),
      ).resolves.toBeUndefined();

      const [entry] = await sql<{ action: string; acting_role: string; after: unknown }[]>`
        select action, acting_role, after from app.planning_org_audit_log
        where entity_type = 'user' and entity_id = ${sarah}
        order by created_at desc limit 1
      `;
      expect(entry?.action).toBe("identity.role.grant");
      expect(entry?.acting_role).toBe("admin");
    });

    it("grants vendor without a confirmation, and refuses customer either way", async () => {
      const sarah = idOf("sarah@example.ca");
      await expect(grantRoleToUser(ctx, admin, sarah, "vendor")).resolves.toBeUndefined();
      await expect(grantRoleToUser(ctx, admin, sarah, "customer")).rejects.toBeInstanceOf(
        ValidationError,
      );
      await expect(revokeRoleFromUser(ctx, admin, sarah, "customer")).rejects.toBeInstanceOf(
        ValidationError,
      );
    });
  });

  describe("the platform cannot be left unadministered", () => {
    it("refuses an administrator acting on their own account", async () => {
      const self = idOf("admin@occasion.test");

      // `assertCanActOnUser` answers "no such account" rather than "not
      // permitted", so the refusal says nothing about the row.
      await expect(suspendAccount(ctx, admin, self, "why")).rejects.toBeInstanceOf(NotFoundError);
      await expect(revokeRoleFromUser(ctx, admin, self, "admin")).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });

    it("cannot be emptied one change at a time", async () => {
      // Sequentially the set cannot reach zero, and the reason is worth
      // stating: whoever is making the change is an administrator, is active,
      // and cannot be their own target — so they are always still counted
      // afterwards. Every removal here is therefore allowed, and the platform
      // still has somebody at the end.
      const sarah = idOf("sarah@example.ca");
      const ada = idOf("ada.okafor@example.ca");
      await grantRoleToUser(ctx, admin, sarah, "admin", "sarah@example.ca");
      await grantRoleToUser(ctx, admin, ada, "admin", "ada.okafor@example.ca");
      await bind("sarah@example.ca");

      signInAs("sarah@example.ca");
      const sarahActor = await getActor(ctx, {});

      await expect(
        revokeRoleFromUser(ctx, sarahActor, idOf("admin@occasion.test"), "admin"),
      ).resolves.toBeUndefined();
      await expect(revokeRoleFromUser(ctx, sarahActor, ada, "admin")).resolves.toBeUndefined();

      // Sarah is the last one, and she is the only person who could remove
      // her own role — which the policy refuses outright.
      await expect(revokeRoleFromUser(ctx, sarahActor, sarah, "admin")).rejects.toBeInstanceOf(
        NotFoundError,
      );

      expect(await countActiveAdmins(ctx.db)).toBe(1);
    });

    it("counts only administrators who could actually sign in", async () => {
      // Each condition removed one at a time, against the count the guard uses.
      // Ada is `active` to begin with — an unverified account would be excluded
      // by the status condition and would prove nothing about the others.
      const ada = idOf("ada.okafor@example.ca");
      await grantRoleToUser(ctx, admin, ada, "admin", "ada.okafor@example.ca");
      await bind("ada.okafor@example.ca");

      const both = await countActiveAdmins(ctx.db);
      expect(both).toBe(2);

      // No provider binding: the account exists and holds the role, and nobody
      // can sign in to it.
      await sql`update app.planning_org_users set auth_provider_sub = null where id = ${ada}`;
      expect(await countActiveAdmins(ctx.db)).toBe(1);

      // Bound again but suspended: same answer, different reason.
      await sql`
        update app.planning_org_users
        set auth_provider_sub = ${"provider-sub-ada.okafor@example.ca"}, status = 'suspended'
        where id = ${ada}
      `;
      expect(await countActiveAdmins(ctx.db)).toBe(1);

      // Active and bound: back to two.
      await sql`update app.planning_org_users set status = 'active' where id = ${ada}`;
      expect(await countActiveAdmins(ctx.db)).toBe(2);
    });

    it("keeps two simultaneous demotions from emptying the set between them", async () => {
      // The race the guard exists for. Without the lock, each transaction sees
      // a platform that still contains the other administrator, both commit,
      // and nobody is left.
      const sarah = idOf("sarah@example.ca");
      await grantRoleToUser(ctx, admin, sarah, "admin", "sarah@example.ca");
      await bind("sarah@example.ca");

      signInAs("sarah@example.ca");
      const sarahActor = await getActor(ctx, {});
      const seededId = idOf("admin@occasion.test");

      signInAs("admin@occasion.test");
      const seededActor = await getActor(ctx, {});

      const results = await Promise.allSettled([
        revokeRoleFromUser(ctx, sarahActor, seededId, "admin"),
        revokeRoleFromUser(ctx, seededActor, sarah, "admin"),
      ]);

      // One of them has to lose — refused by the guard, which runs after its
      // own write and sees a set the other transaction has already emptied.
      // What must never happen is both succeeding.
      expect(results.filter((r) => r.status === "fulfilled").length).toBeLessThan(2);

      expect(await countActiveAdmins(ctx.db)).toBeGreaterThanOrEqual(1);
    });

    it("keeps two simultaneous suspensions from emptying it either", async () => {
      // The same race through the other door. Suspending an administrator
      // removes one as surely as demoting them, so it takes the same lock.
      const sarah = idOf("sarah@example.ca");
      await grantRoleToUser(ctx, admin, sarah, "admin", "sarah@example.ca");
      await bind("sarah@example.ca");

      signInAs("sarah@example.ca");
      const sarahActor = await getActor(ctx, {});
      signInAs("admin@occasion.test");
      const seededActor = await getActor(ctx, {});

      const results = await Promise.allSettled([
        suspendAccount(ctx, sarahActor, idOf("admin@occasion.test"), "one"),
        suspendAccount(ctx, seededActor, sarah, "two"),
      ]);

      expect(results.filter((r) => r.status === "fulfilled").length).toBeLessThan(2);
      expect(await countActiveAdmins(ctx.db)).toBeGreaterThanOrEqual(1);
    });
  });

  describe("the two status actions the plan had omitted", () => {
    it("approves a pending account and refuses any other status", async () => {
      const dae = idOf("dae@kimchikart.ca");
      await approveUser(ctx, admin, dae);

      const [row] = await sql<{ status: string }[]>`
        select status from app.planning_org_users where id = ${dae}
      `;
      expect(row?.status).toBe("active");

      // Not idempotent on purpose: a second approval would write an audit row
      // describing a change that did not happen.
      await expect(approveUser(ctx, admin, dae)).rejects.toBeInstanceOf(ValidationError);
      await expect(approveUser(ctx, admin, idOf("sarah@example.ca"))).rejects.toBeInstanceOf(
        ValidationError,
      );
    });

    it("hands back the address to resend to, and changes no status", async () => {
      const jonah = idOf("jonah.tran@example.ca");
      const { email } = await resendVerification(ctx, admin, jonah);
      expect(email).toBe("jonah.tran@example.ca");

      // The account becomes active when the address is proven, not when an
      // email is posted.
      const [row] = await sql<{ status: string }[]>`
        select status from app.planning_org_users where id = ${jonah}
      `;
      expect(row?.status).toBe("unverified");

      await expect(
        resendVerification(ctx, admin, idOf("sarah@example.ca")),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe("the record", () => {
    it("carries everything a support question needs, so nothing has to be impersonated", async () => {
      const detail = await getUserDetail(ctx, admin, idOf("sarah@example.ca"));

      expect(detail.user.fullName).toBe("Sarah Mensah");
      expect(detail.events.length).toBeGreaterThan(0);
      expect(detail.orders.length).toBeGreaterThan(0);
      expect(detail.orders[0]?.vendorName).toBeTruthy();
      expect(detail.grantableRoles).toEqual(["vendor", "admin"]);
      expect(detail.revocableRoles).toEqual([]);
    });

    it("lists every business somebody works for, not only the one on the row", async () => {
      const rosa = idOf("rosa@bloomandco.ca");
      await sql`
        insert into app.planning_org_vendor_members (vendor_id, user_id, role)
        select id, ${rosa}, 'staff' from app.planning_org_vendors where name = 'Studio Halo'
      `;

      const detail = await getUserDetail(ctx, admin, rosa);
      expect(detail.memberships.map((row) => row.vendorName)).toEqual([
        "Bloom & Co",
        "Studio Halo",
      ]);

      // The row still shows one, chosen by name so it does not move about.
      const list = await listUsersForAdmin(ctx, admin, { filter: "vendor-staff" });
      expect(list.rows.find((row) => row.id === rosa)?.activity).toContain("Bloom & Co");
    });

    it("answers 'no such account' for junk rather than failing the page", async () => {
      for (const notAnId of ["", "abc", "1; drop table x"]) {
        await expect(getUserDetail(ctx, admin, notAnId)).rejects.toBeInstanceOf(NotFoundError);
      }
    });
  });
});
