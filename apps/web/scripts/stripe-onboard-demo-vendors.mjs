import Stripe from "stripe";
import { createDb } from "@occasion/db";
import { listPayableDemoVendors, setDemoConnectedAccount } from "@occasion/db/provisioning";

/**
 * Gives the seeded vendors Stripe Connect Express accounts, in test mode.
 *
 * Without this the demo has approved businesses with nowhere to send money, and
 * every payout parks as `held` with "has not finished payment onboarding" — a
 * state the screens show correctly and which is not what anybody wants to demo.
 *
 * What it does and does not do:
 *
 * - It **creates** a connected account per approved vendor and writes the id
 *   onto the vendor row. That part is fully automatic.
 * - It **cannot** complete the account. Onboarding is Stripe-hosted identity
 *   verification: a person has to open the link and answer it. The script
 *   prints one link per vendor to walk through, which in test mode takes about
 *   a minute each — Stripe offers test values and skip affordances throughout.
 * - Nothing here fabricates a completed account. A vendor whose onboarding is
 *   unfinished keeps `stripe_payouts_enabled_at` null, and the platform parks
 *   their payouts. That is the truth, and the screens say so.
 *
 * Run it against a local or demo stack:
 *
 *   STRIPE_SECRET_KEY='sk_test_…' APP_URL='http://localhost:3000' \
 *   DATABASE_URL='postgresql://…' \
 *   node apps/web/scripts/stripe-onboard-demo-vendors.mjs
 *
 * It is idempotent: a vendor that already has an account gets a fresh
 * onboarding link rather than a second account. The idempotency key is the
 * vendor's own id, so even a torn run cannot mint two.
 */

function required(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is required.`);
    process.exit(1);
  }
  return value;
}

const secretKey = required("STRIPE_SECRET_KEY");
const appUrl = required("APP_URL");
const databaseUrl = required("DATABASE_URL");

if (!secretKey.startsWith("sk_test_")) {
  // The same rule the environment schema keeps. Live mode is gated on a review
  // this milestone excludes, and an operator script is exactly where such a
  // gate gets quietly stepped around.
  console.error("This script is test mode only. STRIPE_SECRET_KEY must start with sk_test_.");
  process.exit(1);
}

const stripe = new Stripe(secretKey, { apiVersion: "2026-08-26.dahlia", maxNetworkRetries: 0 });
const pool = createDb({ connectionString: databaseUrl, maxConnections: 1 });

/**
 * The account id, if Stripe has ever heard of it.
 *
 * The seed writes placeholders — `acct_test_bloom` and friends — so the vendor
 * screen can show a connected business before anybody has onboarded one. They
 * are not accounts. Trusting the column would skip the vendor, then ask Stripe
 * for an onboarding link to something that does not exist, and the error would
 * arrive several steps from the cause.
 *
 * Asking rather than pattern-matching the id, because the question is whether
 * this Stripe account exists and only Stripe can answer it — including for the
 * case where a real account was deleted from the dashboard.
 */
async function existingAccount(accountId) {
  if (!accountId) return null;

  try {
    const account = await stripe.accounts.retrieve(accountId);
    return account.id;
  } catch (error) {
    if (error instanceof Stripe.errors.StripeError && error.code === "resource_missing") {
      console.log(`  ${accountId} is not a Stripe account — replacing it`);
      return null;
    }
    throw error;
  }
}

try {
  const vendors = await listPayableDemoVendors(pool.db);

  if (vendors.length === 0) {
    console.log("No approved demo vendors. Run the seed first.");
  }

  for (const vendor of vendors) {
    let accountId = await existingAccount(vendor.stripeAccountId);

    if (accountId) {
      console.log(`${vendor.name}: already ${accountId}`);
    } else {
      const account = await stripe.accounts.create(
        {
          type: "express",
          country: "CA",
          default_currency: "cad",
          business_profile: { name: vendor.name },
          metadata: { vendor_id: vendor.id, seeded: "true" },
        },
        { idempotencyKey: `acct_${vendor.id}` },
      );

      accountId = account.id;
      await setDemoConnectedAccount(pool.db, vendor.id, accountId);
      console.log(`${vendor.name}: created ${accountId}`);
    }

    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${appUrl}/admin/vendors?connect=refresh`,
      return_url: `${appUrl}/admin/vendors?connect=done`,
      type: "account_onboarding",
    });

    console.log(`  finish onboarding: ${link.url}`);
  }

  console.log(
    "\nOpen each link and complete Stripe's test-mode onboarding. Until you do, " +
      "that vendor's payouts park as held — which is correct, not a bug.",
  );
} finally {
  await pool.close();
}
