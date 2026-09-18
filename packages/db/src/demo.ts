import { seedDemoRows, type SeedResult } from "./seed/index.js";
import { createDb } from "./client.js";

/**
 * Rebuilding the demo data, for the admin screen that offers it.
 *
 * A separate module from `reset.ts`, and a separate entry point from
 * `./testing`, for one reason: `reset` drops the whole schema and reaches the
 * migration runner, which reads the migrations directory off disk. Nothing
 * served by the application may import that — a bundler cannot follow a
 * `readdirSync` and the build fails, which is the honest version of a rule that
 * would otherwise be a comment nobody reads.
 *
 * So this holds the demo-only path and depends on the seed alone. Every guard
 * that decides *whether* a reseed may happen lives in the domain: the
 * deployment tier, the typed confirmation, a job mid-flight, a payment with no
 * outcome yet.
 */

export type { SeedResult } from "./seed/index.js";

/**
 * Tables holding demo-derived rows, in the order they must be emptied.
 *
 * The list is exhaustive rather than "the tables the seed writes": a reseed
 * runs against a database that later phases and tests have also written to. A
 * table left out does NOT raise a foreign-key error — most of these references
 * are `SET NULL` or `CASCADE`, so the delete quietly succeeds and leaves
 * something behind. What that looked like before this list was completed: a
 * message thread detached from every order and participant, an audit row whose
 * actor became NULL so "who approved this vendor" read as nobody, and an
 * `email_sends` row still holding a deleted user's address.
 *
 * Children first. Each entry names the table and how its demo rows are reached.
 */
const DEMO_DELETES = [
  // Communications, which hang off orders, quote requests and users.
  `delete from app.planning_org_messages where thread_id in (
     select id from app.planning_org_threads where order_id in (select id from app.planning_org_orders where is_demo)
        or vendor_id in (select id from app.planning_org_vendors where is_demo)
        or quote_request_id in (select id from app.planning_org_quote_requests
                                where user_id in (select id from app.planning_org_users where is_demo)))`,
  `delete from app.planning_org_thread_participants where user_id in (select id from app.planning_org_users where is_demo)`,
  `delete from app.planning_org_threads where order_id in (select id from app.planning_org_orders where is_demo)
     or vendor_id in (select id from app.planning_org_vendors where is_demo)
     or quote_request_id in (select id from app.planning_org_quote_requests
                             where user_id in (select id from app.planning_org_users where is_demo))`,
  `delete from app.planning_org_notifications where user_id in (select id from app.planning_org_users where is_demo)`,
  `delete from app.planning_org_email_sends where recipient_user_id in (select id from app.planning_org_users where is_demo)
     or to_email in (select email from app.planning_org_users where is_demo)`,

  // Trust.
  `delete from app.planning_org_reviews where order_id in (select id from app.planning_org_orders where is_demo)`,
  `delete from app.planning_org_disputes where order_id in (select id from app.planning_org_orders where is_demo)`,

  // Automation.
  `delete from app.planning_org_job_runs where job_id in (select id from app.planning_org_jobs where is_demo)`,
  `delete from app.planning_org_jobs where is_demo`,

  // Quotes.
  `delete from app.planning_org_quote_offers where quote_request_id in (
     select id from app.planning_org_quote_requests where user_id in (select id from app.planning_org_users where is_demo))`,
  `delete from app.planning_org_quote_request_invites where quote_request_id in (
     select id from app.planning_org_quote_requests where user_id in (select id from app.planning_org_users where is_demo))`,
  `delete from app.planning_org_quote_requests where user_id in (select id from app.planning_org_users where is_demo)`,

  // Money.
  `delete from app.planning_org_payment_links where order_id in (select id from app.planning_org_orders where is_demo)`,
  `delete from app.planning_org_refunds where order_id in (select id from app.planning_org_orders where is_demo)`,
  `delete from app.planning_org_transfers where order_id in (select id from app.planning_org_orders where is_demo)`,
  `delete from app.planning_org_payments where order_id in (select id from app.planning_org_orders where is_demo)`,
  `delete from app.planning_org_order_items where order_id in (select id from app.planning_org_orders where is_demo)`,

  // Capacity, which points at demo orders and demo vendors' services.
  `delete from app.planning_org_capacity_blocks where order_id in (select id from app.planning_org_orders where is_demo)
     or service_id in (select id from app.planning_org_services
                       where vendor_id in (select id from app.planning_org_vendors where is_demo))`,
  `delete from app.planning_org_daily_capacity where service_id in (
     select id from app.planning_org_services where vendor_id in (select id from app.planning_org_vendors where is_demo))`,
  `delete from app.planning_org_blackout_dates where vendor_id in (select id from app.planning_org_vendors where is_demo)`,

  `delete from app.planning_org_orders where is_demo`,
  `delete from app.planning_org_checkouts where user_id in (select id from app.planning_org_users where is_demo)`,

  // Planning.
  `delete from app.planning_org_event_items where event_id in (select id from app.planning_org_events where is_demo)`,
  `delete from app.planning_org_events where is_demo`,

  // Catalogue.
  `delete from app.planning_org_saved_services where user_id in (select id from app.planning_org_users where is_demo)
     or service_id in (select id from app.planning_org_services
                       where vendor_id in (select id from app.planning_org_vendors where is_demo))`,
  `delete from app.planning_org_service_media where service_id in (
     select id from app.planning_org_services where vendor_id in (select id from app.planning_org_vendors where is_demo))`,
  `delete from app.planning_org_service_areas where service_id in (
     select id from app.planning_org_services where vendor_id in (select id from app.planning_org_vendors where is_demo))`,
  `delete from app.planning_org_service_packages where service_id in (
     select id from app.planning_org_services where vendor_id in (select id from app.planning_org_vendors where is_demo))`,
  `delete from app.planning_org_services where vendor_id in (select id from app.planning_org_vendors where is_demo)`,

  // Identity. The audit log goes last, and by actor, so a reseed cannot leave
  // an entry behind with its actor NULLed — a laundered accountability record
  // is worse than no record.
  `delete from app.planning_org_audit_log where actor_user_id in (select id from app.planning_org_users where is_demo)`,
  `delete from app.planning_org_vendor_members where vendor_id in (select id from app.planning_org_vendors where is_demo)`,
  `delete from app.planning_org_vendors where is_demo`,
  `delete from app.planning_org_communication_consents where user_id in (select id from app.planning_org_users where is_demo)`,
  `delete from app.planning_org_user_roles where user_id in (select id from app.planning_org_users where is_demo)`,
  `delete from app.planning_org_users where is_demo`,

  // Provider events. No `is_demo` column and no foreign key to an order, so
  // nothing above reaches them — and a reseed that left them would strand a
  // batch of events naming orders that no longer exist. The sweep would then
  // read those same rows first on every tick and never get to a new one.
  // Emptied outright: a deployment that may be reseeded at all is one whose
  // provider events are about demo bookings.
  `delete from app.planning_org_stripe_events`,

  // Sign-in attempts and invites belonging to demo accounts. Neither is written
  // by the seed, and both survive on `SET NULL` rather than failing — an invite
  // accepted by a deleted account would keep its `accepted_at` and name nobody.
  `delete from app.planning_org_auth_attempts where subject in (select email from app.planning_org_users where is_demo)`,
  `delete from app.planning_org_admin_invites where invited_by_user_id in (select id from app.planning_org_users where is_demo)
     or accepted_user_id in (select id from app.planning_org_users where is_demo)`,

  // The clock overrides, which are measured from the anchor this reseed is
  // about to move. Done here rather than in the caller so the command line and
  // the admin button behave the same way; the `\_` is escaped because an
  // unescaped underscore is a single-character wildcard, and this is a DELETE.
  `delete from app.planning_org_platform_settings where key like 'clock\\_override:%' escape '\\'`,

  // Written by the seed itself, and by nothing else.
  `delete from app.planning_org_seed_meta`,
];

/**
 * Deletes only demo rows and re-seeds them, leaving the schema and any
 * non-demo data in place.
 *
 * This is what an admin reseed button runs. The delete and the reseed share one
 * transaction: split across two, a failure in the second half would leave the
 * button having destroyed exactly the thing it exists to rebuild.
 */
export async function reseedDemo(options: {
  connectionString: string;
  allowDestructive: boolean;
  anchorAt: Date;
}): Promise<SeedResult> {
  if (!options.allowDestructive) {
    throw new Error("reseedDemo() refused: destructive operations are not permitted on this tier.");
  }

  const pool = createDb({ connectionString: options.connectionString, maxConnections: 1 });

  try {
    const counts = await pool.db.transaction(async (tx) => {
      for (const statement of DEMO_DELETES) {
        await tx.execute(statement);
      }
      return seedDemoRows(tx, options.anchorAt);
    });

    return { anchorAt: options.anchorAt, counts };
  } finally {
    await pool.close();
  }
}
