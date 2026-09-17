import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type postgres from "postgres";
import { ownerSql, reseedDemoData, resetDatabase, testDatabaseUrl } from "./harness.js";

/**
 * The seed exists to make the admin screens show what the prototype shows.
 *
 * These assertions are the ones that caught real errors when the plan was
 * red-teamed: the vendor queue is six rows with two pending, the user list
 * spans four statuses, and the order list includes the balance-due order that
 * the ops screen schedules a job for.
 *
 * Dates are asserted as OFFSETS from the anchor, never as literals — an
 * assertion on "2027-03-06" would pass today and fail forever after.
 */

const url = testDatabaseUrl();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** The calendar date of an instant in the zone events are scheduled in. */
const EVENT_TIMEZONE = "America/Toronto";
const localDate = (at: Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: EVENT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);

describe.skipIf(!url)("seed", () => {
  const dbUrl = url as string;
  let sql: postgres.Sql;
  let anchorAt: Date;

  beforeAll(async () => {
    const result = await resetDatabase(dbUrl);
    anchorAt = result.anchorAt;
    sql = ownerSql(dbUrl);
  }, 60_000);

  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });

  it("seeds the six admin vendors, two of them pending and one blocked", async () => {
    const rows = await sql<{ status: string; count: string }[]>`
      select status::text, count(*)::text as count
      from app.vendors
      where slug in ('bloom-and-co', 'kimchi-kart', 'lens-studio',
                     'terrace-rentals', 'the-bloor-quartet', 'studio-halo')
      group by status
    `;

    const byStatus = Object.fromEntries(rows.map((row) => [row.status, Number(row.count)]));
    expect(byStatus).toEqual({ approved: 3, pending: 2, blocked: 1 });
  });

  it("seeds six accounts across all four user statuses, including Bea Varga", async () => {
    const rows = await sql<{ status: string; count: string }[]>`
      select status::text, count(*)::text as count
      from app.users where email <> 'admin@occasion.test'
      group by status
    `;

    const byStatus = Object.fromEntries(rows.map((row) => [row.status, Number(row.count)]));
    expect(byStatus).toEqual({ active: 3, pending: 1, unverified: 1, suspended: 1 });

    const [bea] = await sql<{ status: string }[]>`
      select status::text from app.users where full_name = 'Bea Varga'
    `;
    expect(bea?.status).toBe("suspended");
  });

  it("seeds every order the admin screen and the ops screen refer to", async () => {
    const rows = await sql<{ reference: string }[]>`
      select reference from app.orders order by reference
    `;

    expect(rows.map((row) => row.reference)).toEqual([
      "TO-4165",
      "TO-4171",
      "TO-4181",
      "TO-4188",
      "TO-4191",
      "TO-4192",
      "TO-4207",
    ]);
  });

  it("reproduces the prototype's checkout figures exactly", async () => {
    const [order] = await sql<
      {
        subtotal: string;
        tax: string;
        total: string;
        deposit_amount: string;
        balance_amount: string;
      }[]
    >`
      select subtotal::text, tax::text, total::text,
             deposit_amount::text, balance_amount::text
      from app.orders where reference = 'TO-4192'
    `;

    // Lines 1172–1178: C$290.00 + C$37.70 = C$327.70; deposit C$65.54,
    // balance C$262.16.
    expect(order).toMatchObject({
      subtotal: "29000",
      tax: "3770",
      total: "32770",
      deposit_amount: "6554",
      balance_amount: "26216",
    });
  });

  it("charges no tax for a vendor that is not HST-registered", async () => {
    const [order] = await sql<{ subtotal: string; tax: string; total: string }[]>`
      select subtotal::text, tax::text, total::text
      from app.orders where reference = 'TO-4181'
    `;

    expect(order?.tax).toBe("0");
    expect(order?.subtotal).toBe(order?.total);
  });

  it("reconciles every order: subtotal + tax equals total", async () => {
    const rows = await sql<{ reference: string }[]>`
      select reference from app.orders where subtotal + tax <> total
    `;
    expect(rows).toEqual([]);
  });

  it("reconciles every order: deposit + balance equals total", async () => {
    const rows = await sql<{ reference: string }[]>`
      select reference from app.orders where deposit_amount + balance_amount <> total
    `;
    expect(rows).toEqual([]);
  });

  it("keeps the platform's commission off the vendor's tax", async () => {
    // Commission is 10% of the pre-tax subtotal, never of the total.
    const rows = await sql<{ reference: string }[]>`
      select reference from app.orders
      where commission <> round(subtotal * 0.10) or commission_tax <> round(commission * 0.13)
    `;
    expect(rows).toEqual([]);
  });

  it("balances the books: vendor shares plus the platform cut equal the total", async () => {
    // The identity the money module exists to preserve. Asserted per order
    // from the stored columns, so a rounding change anywhere shows up here.
    const rows = await sql<{ reference: string; gap: string }[]>`
      select o.reference,
             (o.total - (coalesce(sum(t.amount), 0) + o.commission + o.commission_tax))::text as gap
      from app.orders o
      left join app.transfers t on t.order_id = o.id and t.state <> 'reversed'
      where o.state in ('fulfilled', 'completed')
      group by o.id, o.reference, o.total, o.commission, o.commission_tax
      having (o.total - (coalesce(sum(t.amount), 0) + o.commission + o.commission_tax)) <> 0
    `;

    expect(rows).toEqual([]);
  });

  it("seeds at least one open quote request so the expiry job has work", async () => {
    const [row] = await sql<{ count: string }[]>`
      select count(*)::text as count from app.quote_requests where state = 'open'
    `;
    expect(Number(row?.count ?? "0")).toBeGreaterThan(0);
  });

  it("schedules exactly one cooling-window transfer at the 48 hour mark", async () => {
    const rows = await sql<{ run_after: Date }[]>`
      select run_after from app.jobs where type = 'cooling_window_transfer'
    `;

    expect(rows).toHaveLength(1);
    const offsetHours =
      ((rows[0] as { run_after: Date }).run_after.getTime() - anchorAt.getTime()) / HOUR;
    expect(Math.round(offsetHours)).toBe(48);
  });

  it("schedules the balance charges fourteen days before the event", async () => {
    const rows = await sql<{ reference: string; run_after: Date; event_date: string }[]>`
      select o.reference, j.run_after, e.event_date::text
      from app.jobs j
      join app.orders o on o.id = (j.payload ->> 'orderId')::uuid
      join app.events e on e.id = o.event_id
      where j.type = 'charge_balance'
    `;

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const eventAt = new Date(`${row.event_date}T00:00:00Z`).getTime();
      // Both sides have to be read as calendar days in the same zone.
      // `event_date` is the event's date in Toronto, so taking the UTC date of
      // the instant the job runs compares two different calendars — and after
      // 20:00 Toronto the UTC date has already rolled over, which turns a
      // correct fourteen-day lead into thirteen.
      const dueAt = new Date(`${localDate(row.run_after)}T00:00:00Z`).getTime();
      expect((eventAt - dueAt) / DAY, `${row.reference} balance lead time`).toBe(14);
    }
  });

  it("anchors every seeded instant, so a later reseed still produces the demo states", async () => {
    const past = new Date(anchorAt.getTime() - 400 * DAY);
    const result = await resetDatabase(dbUrl, past);

    const [row] = await sql<{ run_after: Date }[]>`
      select run_after from app.jobs where type = 'cooling_window_transfer'
    `;

    const offsetHours = ((row as { run_after: Date }).run_after.getTime() - past.getTime()) / HOUR;
    expect(Math.round(offsetHours)).toBe(48);
    expect(result.anchorAt.getTime()).toBe(past.getTime());

    // Leave the database on the normal anchor for any suite that follows.
    await resetDatabase(dbUrl, anchorAt);
  }, 60_000);

  it("reseeds demo rows without orphaning anything that referenced them", async () => {
    // A thread with a message, an audit entry and a queued email all reference
    // demo rows. Before the delete list was completed these survived the
    // reseed with their references NULLed — a detached message, an audit row
    // with no actor, and a deleted user's address still sitting in email_sends.
    const [user] = await sql<{ id: string; email: string }[]>`
      select id, email from app.users where full_name = 'Sarah Mensah'
    `;
    const [order] = await sql<{ id: string }[]>`
      select id from app.orders where reference = 'TO-4192'
    `;

    await sql`insert into app.threads (order_id, subject) values (${order?.id as string}, 'Test')`;
    const [thread] = await sql<{ id: string }[]>`
      select id from app.threads where subject = 'Test'
    `;
    await sql`
      insert into app.thread_participants (thread_id, user_id)
      values (${thread?.id as string}, ${user?.id as string})
    `;
    await sql`
      insert into app.messages (thread_id, sender_user_id, body)
      values (${thread?.id as string}, ${user?.id as string}, 'private message body')
    `;
    await sql`
      insert into app.audit_log (actor_user_id, action, entity_type)
      values (${user?.id as string}, 'vendor.approve', 'vendor')
    `;
    await sql`
      insert into app.email_sends (to_email, subject, idempotency_key, recipient_user_id)
      values (${user?.email as string}, 'Hello', 'test-key-1', ${user?.id as string})
    `;

    await reseedDemoData(dbUrl, anchorAt);

    for (const table of ["threads", "thread_participants", "messages", "audit_log"]) {
      const [row] = await sql.unsafe<{ count: string }[]>(
        `select count(*)::text as count from app.${table}`,
      );
      expect(Number(row?.count ?? "0"), `${table} should be empty after a reseed`).toBe(0);
    }

    const leftovers = await sql<{ to_email: string }[]>`
      select to_email from app.email_sends
    `;
    expect(leftovers).toEqual([]);

    // And the demo data is actually back.
    const [orders] = await sql<{ count: string }[]>`
      select count(*)::text as count from app.orders
    `;
    expect(Number(orders?.count ?? "0")).toBe(7);
  }, 60_000);

  it("produces the same ids on every reseed", async () => {
    const before = await sql<{ id: string }[]>`
      select id from app.orders order by reference
    `;

    await resetDatabase(dbUrl, anchorAt);

    const after = await sql<{ id: string }[]>`
      select id from app.orders order by reference
    `;

    expect(after).toEqual(before);
  }, 60_000);
});
