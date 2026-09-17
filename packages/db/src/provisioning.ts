import { eq, inArray } from "drizzle-orm";
import type { Db } from "./client.js";
import { users } from "./schema/identity.js";

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
