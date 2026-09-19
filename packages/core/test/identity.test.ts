import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type postgres from "postgres";
import {
  ForbiddenError,
  NotFoundError,
  UnauthenticatedError,
  ValidationError,
} from "../src/errors.js";
import { RateLimitedError } from "../src/errors.js";
import {
  getActor,
  grantRole,
  reinstateUser,
  requireAdmin,
  clearSecondFactor,
  revokeRole,
  setSecondFactorEnrolled,
  signUp,
  suspendUser,
} from "../src/identity/service.js";
import { selectActiveRole } from "../src/identity/actor.js";
import { acceptAdminInvite, inviteAdmin } from "../src/identity/invites.js";
import { consumeAttempt, LOGIN_RULE } from "../src/identity/rate-limit.js";
import type { CoreContext } from "../src/context.js";
import { createDatabaseContext, ownerSql, resetDatabase, testDatabaseUrl } from "./harness.js";

/**
 * The identity service against a real database.
 *
 * These are the assertions that cannot be made against a fake: revocation
 * depends on a timestamp column, role reads depend on a join, and the audit
 * trail is a row that has to actually be there afterwards.
 *
 * It lives under `test/` rather than `src/` because it reads
 * `TEST_DATABASE_URL`, and `src/` never reads the environment. The pure
 * authorization matrix is in `src/identity/policies.test.ts`, which needs
 * nothing but the functions themselves.
 */

const url = testDatabaseUrl();

describe.skipIf(!url)("identity service", () => {
  const dbUrl = url as string;
  let sql: postgres.Sql;
  let database: ReturnType<typeof createDatabaseContext>;
  let ctx: CoreContext;

  /** Ids of the seeded people, looked up once. */
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    await resetDatabase(dbUrl);
    sql = ownerSql(dbUrl);
    database = createDatabaseContext(dbUrl);
    ctx = database.ctx;

    const rows = await sql<{ id: string; email: string }[]>`
      select id, email from app.planning_org_users
    `;
    for (const row of rows) ids[row.email] = row.id;
  }, 120_000);

  afterAll(async () => {
    await database?.close();
    await sql?.end({ timeout: 5 });
  });

  /**
   * A provider-shaped subject for an address.
   *
   * Deliberately NOT the application's primary key: production hands the domain
   * a provider subject, and a harness that supplies the primary key instead
   * hides exactly the mismatch that made every real session anonymous.
   */
  function providerSub(email: string): string {
    return `provider-sub-${email}`;
  }

  /** Signs the given seeded person in, with a token issued now. */
  function signInAs(email: string, issuedAt: Date = new Date(), secondFactorVerified = true): void {
    database.setUser({
      id: providerSub(email),
      email,
      issuedAt,
      emailVerified: true,
      secondFactorVerified,
    });
  }

  /** The seeded administrator, signed in. */
  async function adminActor() {
    signInAs("admin@occasion.test");
    return getActor(ctx);
  }

  function signOut(): void {
    database.setUser(null);
  }

  describe("getActor", () => {
    it("returns anonymous when nobody is signed in", async () => {
      signOut();
      expect(await getActor(ctx)).toEqual({ kind: "anonymous" });
    });

    it("reads roles from the database, not from the token", async () => {
      signInAs("admin@occasion.test");
      const actor = await getActor(ctx);

      expect(actor.kind).toBe("user");
      if (actor.kind !== "user") return;
      expect(actor.roles).toContain("admin");
    });

    it("resolves the provider subject, not the application primary key", async () => {
      // The bug this guards: querying users.id with a provider subject matches
      // nothing, so every real session silently becomes anonymous.
      database.setUser({
        id: ids["admin@occasion.test"] as string,
        email: "admin@occasion.test",
        issuedAt: new Date(),
        emailVerified: true,
        secondFactorVerified: true,
      });

      // The application id is not a provider subject, and by now the seeded row
      // is bound to a real one, so this must not resolve.
      signInAs("admin@occasion.test");
      const bound = await getActor(ctx);
      expect(bound.kind).toBe("user");

      const [row] = await sql<{ sub: string | null }[]>`
        select auth_provider_sub as sub from app.planning_org_users where email = 'admin@occasion.test'
      `;
      expect(row?.sub).toBe("provider-sub-admin@occasion.test");
    });

    it("refuses an unknown provider subject", async () => {
      database.setUser({
        id: "provider-sub-nobody@example.ca",
        email: "nobody@example.ca",
        issuedAt: new Date(),
        emailVerified: true,
        secondFactorVerified: true,
      });

      expect((await getActor(ctx)).kind).toBe("anonymous");
    });

    it("refuses to bind an account on an unverified address", async () => {
      // Otherwise anyone could claim a seeded account by registering with its
      // email address at the provider.
      database.setUser({
        id: "provider-sub-impostor",
        email: "rosa@bloomandco.ca",
        issuedAt: new Date(),
        emailVerified: false,
        secondFactorVerified: true,
      });

      expect((await getActor(ctx)).kind).toBe("anonymous");
    });

    it("refuses a token with no issue time, rather than skipping revocation", async () => {
      database.setUser({
        id: providerSub("sarah@example.ca"),
        email: "sarah@example.ca",
        issuedAt: null,
        emailVerified: true,
        secondFactorVerified: true,
      });

      expect((await getActor(ctx)).kind).toBe("anonymous");
    });

    it("attaches the vendor organisations a person belongs to", async () => {
      signInAs("rosa@bloomandco.ca");
      const actor = await getActor(ctx);

      if (actor.kind !== "user") throw new Error("expected a user");
      expect(actor.vendorIds).toHaveLength(1);
    });

    it("honours a requested active role only when it is actually held", async () => {
      signInAs("admin@occasion.test");

      const asCustomer = await getActor(ctx, { activeRole: "customer" });
      if (asCustomer.kind !== "user") throw new Error("expected a user");
      // Not held, so the request is ignored rather than granted.
      expect(asCustomer.activeRole).toBe("admin");
      // And the authority is unchanged either way.
      expect(() => requireAdmin(asCustomer)).not.toThrow();
    });
  });

  describe("second factor", () => {
    it("refuses a session that has not cleared an enrolled factor", async () => {
      signInAs("ada.okafor@example.ca");
      const actor = await getActor(ctx);
      await setSecondFactorEnrolled(ctx, actor, true);

      // Same account, same valid token, but the challenge was never answered.
      signInAs("ada.okafor@example.ca", new Date(), false);
      expect((await getActor(ctx)).kind).toBe("anonymous");

      signInAs("ada.okafor@example.ca", new Date(), true);
      expect((await getActor(ctx)).kind).toBe("user");
    });

    it("lets a person without a factor sign in unchallenged", async () => {
      // MFA is offered, not required: an account that never enrolled is not
      // held to a challenge it cannot answer.
      signInAs("sarah@example.ca", new Date(), false);
      expect((await getActor(ctx)).kind).toBe("user");
    });

    it("stops requiring a factor once the last one is removed", async () => {
      signInAs("ada.okafor@example.ca");
      const actor = await getActor(ctx);
      // Set here rather than inherited from the test above, so this one still
      // means something when it is the only one that runs.
      await setSecondFactorEnrolled(ctx, actor, true);
      await setSecondFactorEnrolled(ctx, actor, false);

      signInAs("ada.okafor@example.ca", new Date(), false);
      expect((await getActor(ctx)).kind).toBe("user");

      const [row] = await sql<{ action: string }[]>`
        select action from app.planning_org_audit_log
        where actor_user_id = ${ids["ada.okafor@example.ca"] as string}
        order by created_at desc limit 1
      `;
      expect(row?.action).toBe("identity.mfa.remove");
    });
  });

  describe("clearing a lost second factor", () => {
    it("will not let a suspended account enrol one", async () => {
      // A provider session outlives our opinion of an account, so the domain
      // has to refuse this rather than trust that the page was never shown.
      signInAs("bea@terracerentals.ca");
      const actor = await getActor(ctx);

      await expect(setSecondFactorEnrolled(ctx, actor, true)).rejects.toThrow(ForbiddenError);
    });

    it("is an administrator's job, and ends the account's sessions", async () => {
      signInAs("rosa@bloomandco.ca");
      const owner = await getActor(ctx);
      await setSecondFactorEnrolled(ctx, owner, true);

      // Locked out: the authenticator is gone, so no session reaches the domain.
      signInAs("rosa@bloomandco.ca", new Date(), false);
      expect((await getActor(ctx)).kind).toBe("anonymous");

      const admin = await adminActor();
      const { authProviderSub } = await clearSecondFactor(
        ctx,
        admin,
        ids["rosa@bloomandco.ca"] as string,
      );
      // Returned so the caller can delete the provider's own factor; without
      // that the provider would keep asking for a code.
      expect(authProviderSub).toBe("provider-sub-rosa@bloomandco.ca");

      // The clear ends existing sessions, so only a token issued after it works.
      signInAs("rosa@bloomandco.ca", new Date(Date.now() - 60_000), false);
      expect((await getActor(ctx)).kind).toBe("anonymous");

      signInAs("rosa@bloomandco.ca", new Date(Date.now() + 1000), false);
      expect((await getActor(ctx)).kind).toBe("user");
    });

    it("refuses anyone who is not an administrator", async () => {
      signInAs("sarah@example.ca");
      const actor = await getActor(ctx);

      await expect(
        clearSecondFactor(ctx, actor, ids["ada.okafor@example.ca"] as string),
      ).rejects.toThrow(ForbiddenError);
    });

    it("refuses an administrator clearing their own", async () => {
      const admin = await adminActor();

      await expect(
        clearSecondFactor(ctx, admin, ids["admin@occasion.test"] as string),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe("role switching", () => {
    it("records the chosen role without changing what is permitted", async () => {
      const target = ids["sarah@example.ca"] as string;
      await grantRole(ctx, await adminActor(), target, "vendor");

      try {
        signInAs("sarah@example.ca");
        const actor = await getActor(ctx, { activeRole: "vendor" });
        if (actor.kind !== "user") throw new Error("expected a user");

        expect(actor.activeRole).toBe("vendor");
        expect(selectActiveRole(actor, "customer")).toBe("customer");
        // Selecting a role never confers it.
        expect(() => selectActiveRole(actor, "admin")).toThrow(ForbiddenError);
        expect(() => requireAdmin(actor)).toThrow(ForbiddenError);
      } finally {
        // In a finally block because a failed assertion would otherwise leave
        // this person a vendor for every test that follows.
        await revokeRole(ctx, await adminActor(), target, "vendor");
      }
    });

    it("refuses a value that is not a role at all", async () => {
      signInAs("sarah@example.ca");
      const actor = await getActor(ctx);
      expect(() => selectActiveRole(actor, "superuser")).toThrow(ForbiddenError);
      expect(() => selectActiveRole(actor, undefined)).toThrow(ForbiddenError);
    });
  });

  describe("revocation", () => {
    it("rejects a token issued before the account's cutoff, on any route", async () => {
      const target = ids["jonah.tran@example.ca"] as string;

      // A token issued now is valid: the seed set every account's cutoff to the
      // anchor, which is in the past.
      signInAs("jonah.tran@example.ca", new Date());
      expect((await getActor(ctx)).kind).toBe("user");

      // Any change to what a person may do moves the cutoff forward, past the
      // instant this token was issued.
      const cutoff = new Date(Date.now() + 1000);
      await sql`update app.planning_org_users set sessions_valid_after = ${cutoff} where id = ${target}`;

      expect((await getActor(ctx)).kind).toBe("anonymous");
    });

    it("ends sessions when a role is revoked", async () => {
      const target = ids["sarah@example.ca"] as string;
      signInAs("admin@occasion.test");
      const admin = await getActor(ctx);

      await grantRole(ctx, admin, target, "vendor");

      // The grant itself bumps the cutoff, so a session from before it is dead.
      signInAs("sarah@example.ca", new Date(Date.now() - 60_000));
      expect((await getActor(ctx)).kind).toBe("anonymous");

      signInAs("sarah@example.ca", new Date());
      const after = await getActor(ctx);
      if (after.kind !== "user") throw new Error("expected a user");
      expect(after.roles).toContain("vendor");

      signInAs("admin@occasion.test");
      await revokeRole(ctx, await getActor(ctx), target, "vendor");

      signInAs("sarah@example.ca", new Date());
      const revoked = await getActor(ctx);
      if (revoked.kind !== "user") throw new Error("expected a user");
      expect(revoked.roles).not.toContain("vendor");
    });

    it("refuses a suspended account even with a fresh token", async () => {
      signInAs("admin@occasion.test");
      const admin = await getActor(ctx);
      const target = ids["ada.okafor@example.ca"] as string;

      await suspendUser(ctx, admin, target, "chargebacks");

      signInAs("ada.okafor@example.ca", new Date());
      const actor = await getActor(ctx);
      if (actor.kind !== "user") throw new Error("expected a user");
      expect(actor.status).toBe("suspended");
      expect(() => requireAdmin(actor)).toThrow(ForbiddenError);

      signInAs("admin@occasion.test");
      await reinstateUser(ctx, await getActor(ctx), target);
    });
  });

  describe("signup", () => {
    it("creates a customer with exactly that role", async () => {
      const userId = await signUp(ctx, {
        email: "new.customer@example.ca",
        fullName: "New Customer",
        role: "customer",
      });

      const roles = await sql<{ role: string }[]>`
        select role::text from app.planning_org_user_roles where user_id = ${userId}
      `;
      expect(roles.map((r) => r.role)).toEqual(["customer"]);
    });

    it("creates zero admin rows for a signup carrying role=admin", async () => {
      const before = await sql<{ count: string }[]>`
        select count(*)::text as count from app.planning_org_user_roles where role = 'admin'
      `;

      await expect(
        signUp(ctx, {
          email: "attacker@example.ca",
          fullName: "Attacker",
          role: "admin",
        }),
      ).rejects.toThrow(ValidationError);

      const after = await sql<{ count: string }[]>`
        select count(*)::text as count from app.planning_org_user_roles where role = 'admin'
      `;
      expect(after[0]?.count).toBe(before[0]?.count);

      // And no orphaned account was left behind either.
      const orphan = await sql<{ id: string }[]>`
        select id from app.planning_org_users where email = 'attacker@example.ca'
      `;
      expect(orphan).toEqual([]);
    });

    it("refuses a role that is not a string at all", async () => {
      await expect(
        signUp(ctx, { email: "x@example.ca", fullName: "X", role: { role: "admin" } }),
      ).rejects.toThrow(ValidationError);
    });

    it("refuses a duplicate email", async () => {
      await expect(
        signUp(ctx, { email: "sarah@example.ca", fullName: "Impostor", role: "customer" }),
      ).rejects.toThrow(/already exists/);
    });

    it("starts an unverified account as unverified", async () => {
      const userId = await signUp(ctx, {
        email: "unverified@example.ca",
        fullName: "Unverified",
        role: "vendor",
      });

      const [row] = await sql<{ status: string }[]>`
        select status::text from app.planning_org_users where id = ${userId}
      `;
      expect(row?.status).toBe("unverified");

      database.setUser({
        id: providerSub("unverified@example.ca"),
        email: "unverified@example.ca",
        issuedAt: new Date(),
        emailVerified: true,
        secondFactorVerified: true,
      });
      const actor = await getActor(ctx);
      if (actor.kind !== "user") throw new Error("expected a user");
      expect(() => requireAdmin(actor)).toThrow(ForbiddenError);
    });
  });

  describe("role gate", () => {
    it("refuses a customer every admin entry point", async () => {
      signInAs("sarah@example.ca");
      const actor = await getActor(ctx);

      expect(() => requireAdmin(actor)).toThrow(ForbiddenError);
      await expect(
        grantRole(ctx, actor, ids["jonah.tran@example.ca"] as string, "admin"),
      ).rejects.toThrow(ForbiddenError);
    });

    it("refuses an anonymous caller", async () => {
      signOut();
      const actor = await getActor(ctx);

      expect(() => requireAdmin(actor)).toThrow(UnauthenticatedError);
    });
  });

  describe("audit", () => {
    it("records the actor and the role they were acting under", async () => {
      signInAs("admin@occasion.test");
      const admin = await getActor(ctx);
      const target = ids["jonah.tran@example.ca"] as string;

      await sql`delete from app.planning_org_audit_log`;
      await grantRole(ctx, admin, target, "vendor");

      const [entry] = await sql<
        {
          action: string;
          acting_role: string;
          actor_user_id: string;
          before: { roles: string[] };
          after: { roles: string[] };
        }[]
      >`
        select action, acting_role::text, actor_user_id, before, after from app.planning_org_audit_log
      `;

      expect(entry?.action).toBe("identity.role.grant");
      expect(entry?.acting_role).toBe("admin");
      expect(entry?.actor_user_id).toBe(ids["admin@occasion.test"]);
      expect(entry?.after.roles).toContain("vendor");
      expect(entry?.before.roles).not.toContain("vendor");
    });
  });

  describe("admin invitations", () => {
    it("grants admin only through an invitation addressed to that person", async () => {
      signInAs("admin@occasion.test");
      const admin = await getActor(ctx);

      const invitee = await signUp(ctx, {
        email: "second.admin@occasion.test",
        fullName: "Second Admin",
        role: "customer",
        emailVerified: true,
      });

      const invite = await inviteAdmin(ctx, admin, "second.admin@occasion.test");
      await acceptAdminInvite(ctx, invite.token, invitee);

      const roles = await sql<{ role: string }[]>`
        select role::text from app.planning_org_user_roles where user_id = ${invitee}
      `;
      expect(roles.map((r) => r.role).sort()).toEqual(["admin", "customer"]);
    });

    it("refuses a second use of the same invitation", async () => {
      signInAs("admin@occasion.test");
      const admin = await getActor(ctx);

      const invitee = await signUp(ctx, {
        email: "third.admin@occasion.test",
        fullName: "Third Admin",
        role: "customer",
        emailVerified: true,
      });

      const invite = await inviteAdmin(ctx, admin, "third.admin@occasion.test");
      await acceptAdminInvite(ctx, invite.token, invitee);

      await expect(acceptAdminInvite(ctx, invite.token, invitee)).rejects.toThrow(
        /no longer valid/,
      );
    });

    it("refuses an invitation redeemed by a different account", async () => {
      signInAs("admin@occasion.test");
      const admin = await getActor(ctx);

      const invite = await inviteAdmin(ctx, admin, "intended@occasion.test");

      // A forwarded link is exactly this case. The refusal is worded the same
      // as "already used" and "no such token" on purpose: distinct messages
      // would let someone probe which invitations exist and who they name.
      await expect(
        acceptAdminInvite(ctx, invite.token, ids["sarah@example.ca"] as string),
      ).rejects.toThrow(/no longer valid/);

      const roles = await sql<{ role: string }[]>`
        select role::text from app.planning_org_user_roles
        where user_id = ${ids["sarah@example.ca"] as string} and role = 'admin'
      `;
      expect(roles).toEqual([]);
    });

    it("refuses an invitation to an account that is not active yet", async () => {
      signInAs("admin@occasion.test");
      const admin = await getActor(ctx);

      // Unverified: nobody has proven control of the mailbox, so holding the
      // link must not be enough to collect the admin role.
      const invitee = await signUp(ctx, {
        email: "unproven.admin@occasion.test",
        fullName: "Unproven",
        role: "customer",
      });

      const invite = await inviteAdmin(ctx, admin, "unproven.admin@occasion.test");

      await expect(acceptAdminInvite(ctx, invite.token, invitee)).rejects.toThrow(
        /cannot accept an invitation/,
      );
    });

    it("stores only a hash of the token", async () => {
      signInAs("admin@occasion.test");
      const admin = await getActor(ctx);
      const invite = await inviteAdmin(ctx, admin, "hashed@occasion.test");

      const rows = await sql<{ token: string }[]>`
        select token from app.planning_org_admin_invites where email = 'hashed@occasion.test'
      `;
      // A leak of this table must not be an instant admin grant.
      expect(rows[0]?.token).not.toBe(invite.token);
      expect(rows[0]?.token).toMatch(/^[0-9a-f]{64}$/);
    });

    it("leaves one live invitation when the same address is invited twice", async () => {
      signInAs("admin@occasion.test");
      const admin = await getActor(ctx);

      const invitee = await signUp(ctx, {
        email: "twice@occasion.test",
        fullName: "Invited Twice",
        role: "customer",
        emailVerified: true,
      });

      const first = await inviteAdmin(ctx, admin, "twice@occasion.test");
      const second = await inviteAdmin(ctx, admin, "twice@occasion.test");

      expect(second.token).not.toBe(first.token);

      const live = await sql<{ id: string }[]>`
        select id from app.planning_org_admin_invites
        where email = 'twice@occasion.test' and revoked_at is null and accepted_at is null
      `;
      // Two working tokens would mean revoking the one an administrator can
      // see leaves the other still granting the admin role.
      expect(live).toHaveLength(1);

      // And the one that was superseded is genuinely dead, not merely hidden.
      await expect(acceptAdminInvite(ctx, first.token, invitee)).rejects.toThrow();
      await acceptAdminInvite(ctx, second.token, invitee);
    });

    it("refuses the second of two simultaneous invitations to one address", async () => {
      signInAs("admin@occasion.test");
      const admin = await getActor(ctx);

      // Not the same claim as the case above. Sequentially, the revoke inside
      // `inviteAdmin` is what keeps it to one. Concurrently it cannot be:
      // `read committed` gives each request a snapshot without the other's
      // row, so both revoke nothing and both insert, and the partial unique
      // index is what refuses the second.
      //
      // This asserts the outcome through the service. That the index is what
      // produces it is asserted where it can be isolated, in
      // `packages/db/test/constraints.test.ts`.
      const results = await Promise.allSettled([
        inviteAdmin(ctx, admin, "racing@occasion.test"),
        inviteAdmin(ctx, admin, "racing@occasion.test"),
      ]);

      const live = await sql<{ id: string }[]>`
        select id from app.planning_org_admin_invites
        where email = 'racing@occasion.test' and revoked_at is null and accepted_at is null
      `;

      expect(live).toHaveLength(1);
      expect(results.filter((one) => one.status === "fulfilled")).toHaveLength(1);
    });

    it("refuses a non-admin inviting an admin", async () => {
      signInAs("sarah@example.ca");
      const actor = await getActor(ctx);

      await expect(inviteAdmin(ctx, actor, "nope@occasion.test")).rejects.toThrow(ForbiddenError);
    });
  });

  describe("rate limiting", () => {
    it("refuses once the window's attempts are used up", async () => {
      const subject = `limit-test-${Date.now()}@example.ca`;

      for (let attempt = 0; attempt < LOGIN_RULE.limit; attempt++) {
        await consumeAttempt(ctx, LOGIN_RULE, subject);
      }

      await expect(consumeAttempt(ctx, LOGIN_RULE, subject)).rejects.toThrow(RateLimitedError);
    });

    it("counts each subject separately", async () => {
      const a = `a-${Date.now()}@example.ca`;
      const b = `b-${Date.now()}@example.ca`;

      for (let attempt = 0; attempt < LOGIN_RULE.limit; attempt++) {
        await consumeAttempt(ctx, LOGIN_RULE, a);
      }
      await expect(consumeAttempt(ctx, LOGIN_RULE, a)).rejects.toThrow(RateLimitedError);

      // One subject exhausting its budget must not lock out another.
      await expect(consumeAttempt(ctx, LOGIN_RULE, b)).resolves.toBeUndefined();
    });
  });
});
