import { createClient } from "@supabase/supabase-js";
import { createDb } from "@occasion/db";
import { listDemoAccounts, rebindDemoAccountEmail } from "@occasion/db/provisioning";

/**
 * Invites a person onto a seeded demo identity.
 *
 * An empty account shows a tester a demo with nothing in it, so an invitation
 * points a real address at a seeded row that already has orders, events and a
 * history. Three things make that safe, and none of them live here:
 * `rebindDemoAccountEmail` refuses a row that is not demo data, refuses a row
 * holding any role, and refuses an address already in use.
 *
 * What this script owes it in return is the provider account. `email` is unique
 * in both systems, and a binding cleared while the old provider account still
 * exists leaves two live identities resolving to one row — so the old account
 * is deleted *before* the row is rebound, not after.
 *
 * The invitation itself is `inviteUserByEmail`, not `createUser`.
 * `createUser` sends nothing: it would leave an unconfirmed account and no
 * link, on a deployment where signup is closed, and `getActor` binds a subject
 * only once the provider reports the address verified — so the row would be
 * unreachable. No password is ever set; the link is the whole credential.
 *
 *   node --env-file=.env.prod scripts/invite-tester.mjs --email you@example.com --identity sarah@example.ca
 *   node --env-file=.env.prod scripts/invite-tester.mjs --email you@example.com --list
 *
 * A reseed rewrites the address back to the seed's own, and the tester's next
 * request is silently anonymous — `getActor` finds no binding, then no row.
 * Re-run this afterwards.
 *
 * **If the invitation fails after the row has moved** — the free tier allows
 * two auth emails an hour and will not raise that without custom SMTP — the
 * identity no longer answers to its seeded address. Re-run with the *new*
 * address as `--identity`; the rebind is then a no-op and only the invitation
 * is retried.
 */

function required(name) {
  const value = process.env[name];
  if (!value || value === "replace-me") {
    console.error(`Missing or placeholder ${name}.`);
    process.exit(1);
  }
  return value;
}

function flag(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : (process.argv[i + 1] ?? true);
}

if (process.env["APP_TIER"] === "production") {
  console.error("Refusing to run against a production tier.");
  process.exit(1);
}

const supabase = createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { autoRefreshToken: false, persistSession: false },
});
const { db, close } = createDb({ connectionString: required("DATABASE_URL") });

try {
  const accounts = await listDemoAccounts(db);

  if (flag("list")) {
    for (const a of accounts) console.log(`${a.email}\t${a.status}\t${a.fullName}`);
    process.exit(0);
  }

  const email = flag("email");
  const identity = flag("identity");
  if (typeof email !== "string" || typeof identity !== "string") {
    console.error("Usage: --email <address> --identity <seeded email> [--list]");
    process.exit(1);
  }

  const target = accounts.find((a) => a.email === identity.trim().toLowerCase());
  if (!target) {
    console.error(`No demo account ${identity}. Try --list.`);
    process.exit(1);
  }

  // The provider account for the identity's *current* address, deleted before
  // the row moves. Its absence is what makes clearing the binding safe.
  const { data: page, error: listError } = await supabase.auth.admin.listUsers({ perPage: 200 });
  if (listError) throw listError;

  const existing = page.users.find((u) => u.email === target.email);
  if (existing) {
    const { error } = await supabase.auth.admin.deleteUser(existing.id);
    if (error) throw error;
    console.log(`deleted the provider account for ${target.email}`);
  }

  const moved = await rebindDemoAccountEmail(db, { userId: target.id, email });
  console.log(`${moved.previousEmail} -> ${moved.email}`);

  const { error } = await supabase.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${required("APP_URL")}/auth-callback?next=/`,
  });
  if (error) throw error;

  console.log(`invited ${email}; the link signs them in and binds the row on first use`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await close();
}
