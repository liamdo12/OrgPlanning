import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "./client.js";
import { userRoles, users, vendors } from "./schema/identity.js";

/**
 * Support for giving seeded accounts provider logins.
 *
 * The seed writes `planning_org_users` rows; it cannot create accounts at the
 * auth provider, which lives outside the database. The operator script in
 * `apps/web` bridges the two and needs these two queries — they are here rather
 * than there because `drizzle-orm` is a dependency of this package and not of
 * the app.
 */

export type DemoAccount = {
  id: string;
  email: string;
  fullName: string;
  status: string;
  /** The provider subject, if a sign-in has ever bound one. */
  authProviderSub: string | null;
};

/** Every demo account, whether or not it has a provider login yet. */
export async function listDemoAccounts(db: Db): Promise<DemoAccount[]> {
  return db
    .select({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
      status: users.status,
      authProviderSub: users.authProviderSub,
    })
    .from(users)
    .where(eq(users.isDemo, true));
}

/**
 * Forgets a provider subject that no longer refers to anything.
 *
 * Deleting an account at the provider leaves the binding behind, and the
 * binding is what makes the row unusable: `getActor` looks the new subject up,
 * finds nothing, and then cannot bind it because `bindProviderSub` only ever
 * fills a NULL — deliberately, so that a verified address cannot be moved from
 * one provider identity to another. The row is then unreachable by anyone.
 *
 * Clearing it is safe only because the account it pointed at is gone, which is
 * the caller's job to establish.
 */
export async function forgetProviderBinding(db: Db, userIds: readonly string[]): Promise<number> {
  if (userIds.length === 0) return 0;

  const cleared = await db
    .update(users)
    .set({ authProviderSub: null })
    .where(inArray(users.id, [...userIds]))
    .returning({ id: users.id });

  return cleared.length;
}

/** A vendor that needs somewhere for its money to go. */
export type PayableVendor = {
  id: string;
  name: string;
  slug: string;
  stripeAccountId: string | null;
};

/**
 * Approved demo vendors, with whatever connected account they already have.
 *
 * Here for the same reason as the two above: `drizzle-orm` is a dependency of
 * this package and not of the app, and the operator script that completes
 * payment onboarding lives there.
 */
export async function listPayableDemoVendors(db: Db): Promise<PayableVendor[]> {
  return db
    .select({
      id: vendors.id,
      name: vendors.name,
      slug: vendors.slug,
      stripeAccountId: vendors.stripeAccountId,
    })
    .from(vendors)
    .where(and(eq(vendors.isDemo, true), eq(vendors.status, "approved")))
    .orderBy(vendors.name);
}

/**
 * Records the connected account an operator script has just created.
 *
 * The enabled timestamps are cleared, not left alone. The seed sets them
 * alongside a placeholder account id so the vendor screen has something to
 * show; a freshly created account has completed no onboarding, and carrying
 * those timestamps over would leave the row claiming payouts work when the
 * account behind it cannot take one. They come back when the provider says so,
 * through `account.updated` or a status refresh.
 */
export async function setDemoConnectedAccount(
  db: Db,
  vendorId: string,
  accountId: string,
): Promise<void> {
  await db
    .update(vendors)
    .set({
      stripeAccountId: accountId,
      stripeStatus: "pending",
      stripeChargesEnabled: null,
      stripePayoutsEnabled: null,
    })
    .where(eq(vendors.id, vendorId));
}

/** Why a rebind was refused, so the caller can say something useful. */
export class RebindRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RebindRefused";
  }
}

/**
 * Points a seeded demo identity at a real person's address.
 *
 * An invited tester wants a demo with something in it — orders, events, a
 * history — which means landing on a seeded row rather than an empty one. That
 * is a privileged write, so it lives here with the other guarded ones rather
 * than in a script, and it refuses three things:
 *
 * **A row that is not demo data.** A real person's account is not a seat to be
 * handed out.
 *
 * **A row that holds a role nobody may give themselves.** Every seeded row
 * carries a role, so refusing all of them would refuse every identity worth
 * inheriting. What matters is *which* role: `customer` and `vendor` are the two
 * a person picks for themselves at signup, so landing on one grants nothing
 * they could not have taken. `admin` is the opposite — handing somebody
 * `admin@occasion.test` is a platform-administrator grant with no token, no
 * typed confirmation and no audit entry. Anything outside the self-assignable
 * pair is refused, and privileged roles are granted through the audited invite
 * flow or not at all.
 *
 * **An address already in use.** `email` is unique; a collision would surface
 * as a constraint error from somewhere far less clear.
 *
 * Clearing the provider binding is the caller's responsibility to earn: delete
 * the provider account for the row's *current* address first. A binding cleared
 * while its account still exists leaves two live provider identities resolving
 * to one row, and whichever binds first wins while the other is silently
 * nobody.
 */
export async function rebindDemoAccountEmail(
  db: Db,
  input: { userId: string; email: string },
): Promise<{ id: string; previousEmail: string; email: string }> {
  const email = input.email.trim().toLowerCase();

  const [row] = await db
    .select({ id: users.id, email: users.email, isDemo: users.isDemo })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);

  if (!row) throw new RebindRefused(`No user ${input.userId}.`);
  if (!row.isDemo) throw new RebindRefused(`${row.email} is not demo data.`);

  const roles = await db
    .select({ role: userRoles.role })
    .from(userRoles)
    .where(eq(userRoles.userId, row.id));

  // Kept in step with `SELF_ASSIGNABLE_ROLES` in the domain, which this package
  // may not import. The pair is small and the consequence of drifting is loud:
  // a role that becomes self-assignable and is not added here only makes this
  // function stricter than it needs to be, never laxer.
  const selfAssignable = new Set(["customer", "vendor"]);
  const privileged = roles.map((r) => r.role).filter((role) => !selfAssignable.has(role));

  if (privileged.length > 0) {
    throw new RebindRefused(
      `${row.email} holds ${privileged.join(", ")}, which nobody may give themselves. ` +
        "Grant a privileged role through the audited invite flow, never by handing somebody a row that already has one.",
    );
  }

  const [taken] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (taken && taken.id !== row.id) {
    throw new RebindRefused(`${email} already belongs to another account.`);
  }

  await db.update(users).set({ email, authProviderSub: null }).where(eq(users.id, row.id));

  return { id: row.id, previousEmail: row.email, email };
}
