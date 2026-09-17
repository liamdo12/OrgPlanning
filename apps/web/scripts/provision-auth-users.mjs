import { createClient } from "@supabase/supabase-js";
import { createDb } from "@occasion/db";
import { users } from "@occasion/db/schema";

/**
 * Gives the seeded accounts provider logins.
 *
 * The seed writes the `app.users` rows — that is what every screen reads — but
 * it cannot create accounts at the auth provider, which lives outside the
 * database. Without this step the seeded administrator exists and nobody can
 * sign in as them.
 *
 * It touches demo rows only, and refuses to run against a production tier. One
 * shared operator password across every account it creates is a fine thing for
 * a demo stack and a terrible one anywhere else, and a real person who has not
 * signed in yet is exactly the row it must not mint a known password for.
 *
 * It creates the provider account only. The link between the two is left to the
 * first sign-in, where `getActor` binds `auth_provider_sub` after the provider
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

const pool = createDb({ connectionString: databaseUrl });

try {
  const rows = await pool.db
    .select({
      email: users.email,
      fullName: users.fullName,
      status: users.status,
      isDemo: users.isDemo,
      authProviderSub: users.authProviderSub,
    })
    .from(users);

  let created = 0;
  let skipped = 0;

  for (const row of rows) {
    // Demo rows only — everything the seed writes carries the flag, the
    // administrator included. Filtered here rather than in the query because
    // `drizzle-orm` is not resolvable from this package.
    if (!row.isDemo || row.authProviderSub) {
      skipped += 1;
      continue;
    }

    const { error } = await admin.auth.admin.createUser({
      email: row.email,
      password,
      // Matches the state the seed describes: only accounts the seed calls
      // verified get a confirmed address.
      email_confirm: row.status !== "unverified",
      user_metadata: { full_name: row.fullName },
    });

    if (error) {
      // Already there from an earlier run, most likely. Say so rather than
      // failing the whole pass.
      console.warn(`  ${row.email}: ${error.message}`);
      skipped += 1;
      continue;
    }

    created += 1;
    console.warn(`  ${row.email}: provider account created`);
  }

  console.warn(`provision: ${created} created, ${skipped} skipped`);
} finally {
  await pool.close();
}
