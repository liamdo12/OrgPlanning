import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "./client.js";
import { users, vendors } from "./schema/identity.js";

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
