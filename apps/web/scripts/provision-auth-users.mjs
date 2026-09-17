import { createClient } from "@supabase/supabase-js";
import { createDb } from "@occasion/db";
import { forgetProviderBinding, listDemoAccounts } from "@occasion/db/provisioning";

/**
 * Gives the seeded accounts provider logins.
 *
 * The seed writes the `app.planning_org_users` rows — that is what every screen
 * reads — but it cannot create accounts at the auth provider, which lives
 * outside the database. Without this step the seeded administrator exists and
 * nobody can sign in as them.
 *
 * It touches demo rows only, and refuses to run against a production tier. One
 * shared operator password across every account it creates is a fine thing for
 * a demo stack and a terrible one anywhere else, and a real person who has not
 * signed in yet is exactly the row it must not mint a known password for.
 *
 * What counts as "already provisioned" is whether an account exists **at the
 * provider**, not whether our row remembers one. Those two disagree the moment
 * someone deletes a user from the provider's dashboard, and the stale binding
 * left behind is worse than nothing: `getActor` cannot bind the replacement,
 * because binding only ever fills a NULL, so the row becomes unreachable. This
 * clears such a binding before creating the new account.
 *
 * It creates the provider account only. Linking the two is left to the first
 * sign-in, where `getActor` binds `auth_provider_sub` once the provider
 * confirms the address — the same path a real person takes, and the one the
 * tests cover. An account seeded as `unverified` is created unconfirmed, so it
 * stays the "never confirmed their email" case the admin screens exist to show.
 *
 * Run it against a local or demo stack:
 *
 *   SEED_USER_PASSWORD='…' pnpm --filter @occasion/web auth:provision
 *
 * The password is never stored here and never defaulted. Use a throwaway one;
 * these are demo accounts on a test stack.
 */

function required(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}.`);
    process.exit(1);
  }
  // The template's placeholder is long enough to look like a value and reaches
  // the provider, which rejects it as a malformed token — once per account,
  // with no hint that the key was never filled in.
  if (value === "replace-me") {
    console.error(`${name} is still the .env.example placeholder.`);
    console.error("`pnpm supabase status` prints the real one.");
    process.exit(1);
  }
  return value;
}

if (process.env["APP_TIER"] === "production") {
  console.error("Refusing to run against a production tier.");
  process.exit(1);
}

const supabaseUrl = required("SUPABASE_URL");
const serviceRoleKey = required("SUPABASE_SERVICE_ROLE_KEY");
const databaseUrl = required("DATABASE_URL");
const password = required("SEED_USER_PASSWORD");

if (password.length < 10) {
  console.error("SEED_USER_PASSWORD must be at least 10 characters.");
  process.exit(1);
}

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/** Every address the provider already knows, across as many pages as it takes. */
async function providerAccountEmails() {
  const emails = new Set();
  const perPage = 200;

  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) {
      console.error(`Could not list provider accounts: ${error.message}`);
      process.exit(1);
    }

    for (const user of data.users) {
      if (user.email) emails.add(user.email.toLowerCase());
    }

    if (data.users.length < perPage) return emails;
  }
}

const pool = createDb({ connectionString: databaseUrl });

try {
  const accounts = await listDemoAccounts(pool.db);
  const known = await providerAccountEmails();

  const missing = accounts.filter((account) => !known.has(account.email.toLowerCase()));
  const alreadyThere = accounts.length - missing.length;

  // Bindings to accounts the provider no longer has. Cleared before anything is
  // created, so that a failure half way through still leaves rows someone can
  // sign in to once the account exists, rather than rows nothing can reach.
  const stale = missing.filter((account) => account.authProviderSub !== null);
  if (stale.length > 0) {
    const cleared = await forgetProviderBinding(
      pool.db,
      stale.map((account) => account.id),
    );
    console.warn(`  cleared ${cleared} binding(s) to accounts the provider no longer has`);
  }

  let created = 0;

  for (const account of missing) {
    const { error } = await admin.auth.admin.createUser({
      email: account.email,
      password,
      // Matches the state the seed describes: only accounts the seed calls
      // verified get a confirmed address.
      email_confirm: account.status !== "unverified",
      user_metadata: { full_name: account.fullName },
    });

    if (error) {
      console.warn(`  ${account.email}: ${error.message}`);
      continue;
    }

    created += 1;
    console.warn(`  ${account.email}: provider account created`);
  }

  console.warn(`provision: ${created} created, ${alreadyThere} already had one`);
} finally {
  await pool.close();
}
