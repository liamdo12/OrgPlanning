import { and, eq, inArray } from "drizzle-orm";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { authAttempts, userRoles, users } from "@occasion/db/schema";
import { createDb } from "@occasion/db";
import { reseedDemo } from "@occasion/db/testing";
import { listDemoAccounts } from "@occasion/db/provisioning";

/**
 * Putting the environment back to a state the journey can run against.
 *
 * The journey approves a vendor, suspends an account and refunds an order. Run
 * twice without this, its second pass finds Kimchi Kart already approved and
 * fails on a button that is no longer there — which looks like a regression and
 * is not one. So the suite reseeds the demo rows before it starts, which is the
 * same operation the automations screen offers an administrator.
 *
 * Only demo rows. `reseedDemo` deletes what `is_demo` marks and writes the seed
 * again; anything a person created on the environment is untouched.
 */

export const ADMIN_EMAIL = "admin@occasion.test";

/**
 * A signed-in account holding no admin role.
 *
 * The authorization spec needs one: "an anonymous visitor is sent to the login
 * screen" is the easy half, and the half that has never been the bug. What the
 * admin surface has to refuse is somebody who is signed in, in good standing,
 * and simply not an administrator.
 */
export const CUSTOMER_EMAIL = "sarah@example.ca";

/**
 * A customer who has planned nothing at all.
 *
 * The screen a new account lands on is a designed one — a hero, two calls to
 * action, three numbered steps — and no seeded customer can reach it. Sarah and
 * Ada own three events each, and the one seeded customer with none is
 * `unverified`, which the gate refuses. Cancelling somebody's events does not
 * produce the state either: the planner lists cancelled events too.
 *
 * So the suite makes one, and it is demo data like everything else it touches —
 * the next reseed deletes it.
 */
export const NEW_CUSTOMER_EMAIL = "new-customer@occasion.test";

/** What the account menu will greet them by, so the screen is not half-drawn. */
const NEW_CUSTOMER_NAME = "Nina Alvarez";

/**
 * The password the suite signs in with.
 *
 * Set by the suite rather than assumed, because the provider accounts on a
 * long-lived demo environment were created by somebody months ago with a
 * password nobody wrote down. Resetting it through the service-role key is the
 * only way a fresh checkout can sign in at all, and it keeps the credential out
 * of the repository: it is minted per run unless the environment names one.
 */
export const SIGN_IN_PASSWORD =
  process.env["E2E_PASSWORD"] ?? `e2e-${process.pid}-${Date.now().toString(36)}`;

/**
 * Whether the provider key is a real test key rather than the template's.
 *
 * The journey's money step calls Stripe for real, in test mode. With the
 * placeholder from `.env.example` the call fails at the provider with "invalid
 * API key" — and the screen reports that failure exactly as it reports a
 * declined card, so an assertion that "the administrator was told something"
 * stays green while proving nothing about payments.
 *
 * The repository deliberately has no way to substitute a fake provider in the
 * running app: `@occasion/core/testing` is out of reach of `apps/web` on
 * purpose, because a fake provider in a request handler is a booking nobody
 * paid for. So the step is skipped, loudly, rather than faked.
 */
export function stripeConfigured(): boolean {
  const key = process.env["STRIPE_SECRET_KEY"] ?? "";
  return /^sk_test_[A-Za-z0-9]{16,}$/.test(key) && !key.includes("replace");
}

/**
 * Removes every authenticator attached to one address.
 *
 * Its own export because two callers need it: the reseed, which must not leave
 * a stranded factor for the next run, and the MFA spec's own teardown, which
 * must not leave one for the retry — Playwright re-runs the failed *test*, not
 * the setup project, so a failure after enrolment would otherwise land the
 * retry on a challenge screen and turn one failure into two.
 */
export async function clearSecondFactors(email: string): Promise<void> {
  const supabase = serviceRoleClient();

  const { data } = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 });
  const user = data?.users.find((one) => one.email?.toLowerCase() === email.toLowerCase());
  if (!user) return;

  const { data: factors } = await supabase.auth.admin.mfa.listFactors({ userId: user.id });
  for (const factor of factors?.factors ?? []) {
    await supabase.auth.admin.mfa.deleteFactor({ id: factor.id, userId: user.id });
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set; the E2E suite cannot reach the environment.`);
  return value;
}

function serviceRoleClient(): SupabaseClient {
  return createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Gives one address a provider account this run knows the password to.
 *
 * Create-or-update, because the provider outlives the reseed: the demo rows are
 * rebuilt every run and the accounts that sign in to them are not.
 */
async function giveProviderLogin(
  supabase: SupabaseClient,
  email: string,
  fullName: string,
): Promise<void> {
  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) throw new Error(`Could not list provider accounts: ${error.message}`);

  const existing = data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());

  if (existing) {
    const { error: updateError } = await supabase.auth.admin.updateUserById(existing.id, {
      password: SIGN_IN_PASSWORD,
      email_confirm: true,
    });
    if (updateError) throw new Error(`Could not set ${email}'s password: ${updateError.message}`);
    return;
  }

  const { error: createError } = await supabase.auth.admin.createUser({
    email,
    password: SIGN_IN_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (createError) throw new Error(`Could not create ${email}: ${createError.message}`);
}

/**
 * Waits out the rest of the current second before anybody signs in.
 *
 * Every write above sets `sessions_valid_after` to now, and a session issued
 * before that instant is refused. A JWT carries `iat` in **whole seconds**, so a
 * sign-in within the same second presents a token that looks a fraction of a
 * second too old — which arrives as a sign-in that intermittently does not
 * happen, depending on where in the second the write landed.
 *
 * The alternative is a tolerance in the comparison, and a revocation that
 * accepts tokens issued in the same second as itself is a revocation with a hole
 * in it.
 */
async function settleTheSecond(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 1_100 - (Date.now() % 1_000)));
}

/**
 * Builds the customer who owns nothing, and gives them a way in.
 *
 * Run **after** the admin projects, deliberately: this is a row in `users`, and
 * an admin spec that counted accounts before it existed and asserted after it
 * did would fail on a change that has nothing to do with the admin screens.
 *
 * The domain row is rebuilt rather than reused so the account is empty on every
 * run — if a journey ever gives this person an event, the next run must not
 * inherit it. `is_demo` is what makes both halves true: the reseed sweeps it,
 * and nothing that is not demo data carries that address.
 */
export async function provisionNewCustomer(): Promise<void> {
  const connectionString = required("DATABASE_URL");

  await giveProviderLogin(serviceRoleClient(), NEW_CUSTOMER_EMAIL, NEW_CUSTOMER_NAME);

  const pool = createDb({ connectionString });
  try {
    // Only ever a demo row. A real account holding this address would collide on
    // the insert instead, which is the loud answer rather than the quiet one.
    await pool.db
      .delete(users)
      .where(and(eq(users.email, NEW_CUSTOMER_EMAIL), eq(users.isDemo, true)));

    const [row] = await pool.db
      .insert(users)
      .values({
        email: NEW_CUSTOMER_EMAIL,
        fullName: NEW_CUSTOMER_NAME,
        status: "active",
        // The provider confirms the address, and `getActor` binds the subject to
        // this row on the first sign-in only when the token says so.
        emailVerifiedAt: new Date(),
        isDemo: true,
      })
      .returning({ id: users.id });

    if (!row) throw new Error(`Could not create the domain row for ${NEW_CUSTOMER_EMAIL}.`);

    // What signing up gives somebody. The customer screens gate on status
    // rather than on this, but an account that reached them by a route no real
    // account takes is a fixture testing its own shortcut.
    await pool.db.insert(userRoles).values({ userId: row.id, role: "customer" });
  } finally {
    await pool.close();
  }

  await settleTheSecond();
}

/**
 * Reseeds the demo data and makes sure the suite can sign in.
 *
 * Refuses a production tier outright. Everything below deletes rows or resets a
 * password, and neither belongs anywhere near real accounts.
 */
export async function resetEnvironment(): Promise<void> {
  if (process.env["APP_TIER"] === "production") {
    throw new Error("Refusing to reseed a production tier.");
  }

  const connectionString = required("DATABASE_URL");

  // The same refusal the admin button gets. `ALLOW_DESTRUCTIVE_SEED` is false
  // on a production tier and the reseed is refused there twice over — the check
  // below and the check inside `reseedDemo` — which is the arrangement the
  // deployment guard depends on.
  if (process.env["ALLOW_DESTRUCTIVE_SEED"] !== "true") {
    throw new Error(
      "ALLOW_DESTRUCTIVE_SEED is not true; this environment does not permit the E2E reseed.",
    );
  }

  await reseedDemo({ connectionString, allowDestructive: true, anchorAt: new Date() });

  const pool = createDb({ connectionString });
  try {
    // The login counters for the accounts this suite owns, and nothing else. A
    // *failed* sign-in counts against a limit of ten in fifteen minutes; a
    // successful one clears the counter, so an uninterrupted run spends
    // nothing. What this is for is the run that failed halfway and left its
    // attempts behind, so the next run does not start in somebody else's hole
    // and fail for a reason that has nothing to do with the change.
    //
    // Narrow on purpose. It clears three subjects on a stack it has just
    // reseeded; it does not raise the limit, disable it, or touch anybody
    // else's counter. That the limit exists and fires is asserted directly, in
    // `packages/core/test/identity.test.ts`.
    await pool.db
      .delete(authAttempts)
      .where(
        and(
          eq(authAttempts.scope, "login"),
          inArray(authAttempts.subject, [
            `email:${ADMIN_EMAIL}`,
            `email:${CUSTOMER_EMAIL}`,
            `email:${NEW_CUSTOMER_EMAIL}`,
          ]),
        ),
      );

    const supabase = serviceRoleClient();

    // The reseed rewrites `app.planning_org_users`, which drops the binding to
    // the provider account. `getActor` rebinds on the next sign-in, exactly as
    // it does for a real person, so nothing has to be done about that here —
    // but the provider account itself has to exist and have a password this
    // run knows.
    const accounts = await listDemoAccounts(pool.db);

    for (const email of [ADMIN_EMAIL, CUSTOMER_EMAIL]) {
      const seeded = accounts.find((account) => account.email === email);
      if (!seeded) throw new Error(`The seed has no ${email}; reseeding did not run.`);

      await giveProviderLogin(supabase, email, seeded.fullName);

      // Any authenticator left behind by an MFA run that died halfway. The
      // secret only ever existed in that run's memory, so the account is
      // otherwise one nothing can sign in as again — and the reseed clears
      // `mfa_enrolled_at` on our own row without touching the provider's
      // factor, which is precisely the half-cleared state that leaves somebody
      // bouncing off a challenge they cannot answer.
      await clearSecondFactors(email);
    }
  } finally {
    await pool.close();
  }

  await settleTheSecond();
}
