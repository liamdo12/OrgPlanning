import postgres from "postgres";
import { migrate } from "./migrate.js";
import { seed, seedDemoRows, type SeedResult } from "./seed/index.js";
import { createDb } from "./client.js";

/**
 * Drops the `app` schema, re-migrates and re-seeds.
 *
 * `allowDestructive` is a required argument rather than a flag with a default,
 * because the only thing standing between this function and a production
 * database is the caller remembering what it does. The CLI wrappers resolve it
 * from the deployment tier and refuse outright in production.
 */
export async function reset(options: {
  connectionString: string;
  allowDestructive: boolean;
  anchorAt: Date;
}): Promise<SeedResult> {
  if (!options.allowDestructive) {
    throw new Error("reset() refused: destructive operations are not permitted on this tier.");
  }

  const sql = postgres(options.connectionString, { max: 1, prepare: false, onnotice: () => {} });
  try {
    await sql.unsafe(`drop schema if exists app cascade;`);
  } finally {
    await sql.end({ timeout: 5 });
  }

  await migrate(options.connectionString);

  return seed({ connectionString: options.connectionString, anchorAt: options.anchorAt });
}

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
  `delete from app.messages where thread_id in (
     select id from app.threads where order_id in (select id from app.orders where is_demo)
        or vendor_id in (select id from app.vendors where is_demo)
        or quote_request_id in (select id from app.quote_requests
                                where user_id in (select id from app.users where is_demo)))`,
  `delete from app.thread_participants where user_id in (select id from app.users where is_demo)`,
  `delete from app.threads where order_id in (select id from app.orders where is_demo)
     or vendor_id in (select id from app.vendors where is_demo)
     or quote_request_id in (select id from app.quote_requests
                             where user_id in (select id from app.users where is_demo))`,
  `delete from app.notifications where user_id in (select id from app.users where is_demo)`,
  `delete from app.email_sends where recipient_user_id in (select id from app.users where is_demo)
     or to_email in (select email from app.users where is_demo)`,

  // Trust.
  `delete from app.reviews where order_id in (select id from app.orders where is_demo)`,
  `delete from app.disputes where order_id in (select id from app.orders where is_demo)`,

  // Automation.
  `delete from app.job_runs where job_id in (select id from app.jobs where is_demo)`,
  `delete from app.jobs where is_demo`,

  // Quotes.
  `delete from app.quote_offers where quote_request_id in (
     select id from app.quote_requests where user_id in (select id from app.users where is_demo))`,
  `delete from app.quote_request_invites where quote_request_id in (
     select id from app.quote_requests where user_id in (select id from app.users where is_demo))`,
  `delete from app.quote_requests where user_id in (select id from app.users where is_demo)`,

  // Money.
  `delete from app.payment_links where order_id in (select id from app.orders where is_demo)`,
  `delete from app.refunds where order_id in (select id from app.orders where is_demo)`,
  `delete from app.transfers where order_id in (select id from app.orders where is_demo)`,
  `delete from app.payments where order_id in (select id from app.orders where is_demo)`,
  `delete from app.order_items where order_id in (select id from app.orders where is_demo)`,

  // Capacity, which points at demo orders and demo vendors' services.
  `delete from app.capacity_blocks where order_id in (select id from app.orders where is_demo)
     or service_id in (select id from app.services
                       where vendor_id in (select id from app.vendors where is_demo))`,
  `delete from app.daily_capacity where service_id in (
     select id from app.services where vendor_id in (select id from app.vendors where is_demo))`,
  `delete from app.blackout_dates where vendor_id in (select id from app.vendors where is_demo)`,

  `delete from app.orders where is_demo`,
  `delete from app.checkouts where user_id in (select id from app.users where is_demo)`,

  // Planning.
  `delete from app.event_items where event_id in (select id from app.events where is_demo)`,
  `delete from app.events where is_demo`,

  // Catalogue.
  `delete from app.saved_services where user_id in (select id from app.users where is_demo)
     or service_id in (select id from app.services
                       where vendor_id in (select id from app.vendors where is_demo))`,
  `delete from app.service_media where service_id in (
     select id from app.services where vendor_id in (select id from app.vendors where is_demo))`,
  `delete from app.service_areas where service_id in (
     select id from app.services where vendor_id in (select id from app.vendors where is_demo))`,
  `delete from app.service_packages where service_id in (
     select id from app.services where vendor_id in (select id from app.vendors where is_demo))`,
  `delete from app.services where vendor_id in (select id from app.vendors where is_demo)`,

  // Identity. The audit log goes last, and by actor, so a reseed cannot leave
  // an entry behind with its actor NULLed — a laundered accountability record
  // is worse than no record.
  `delete from app.audit_log where actor_user_id in (select id from app.users where is_demo)`,
  `delete from app.vendor_members where vendor_id in (select id from app.vendors where is_demo)`,
  `delete from app.vendors where is_demo`,
  `delete from app.communication_consents where user_id in (select id from app.users where is_demo)`,
  `delete from app.user_roles where user_id in (select id from app.users where is_demo)`,
  `delete from app.users where is_demo`,

  // Written by the seed itself, and by nothing else.
  `delete from app.seed_meta`,
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
