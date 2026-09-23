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
      from app.planning_org_vendors
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
      from app.planning_org_users where email <> 'admin@occasion.test'
      group by status
    `;

    const byStatus = Object.fromEntries(rows.map((row) => [row.status, Number(row.count)]));
    expect(byStatus).toEqual({ active: 3, pending: 1, unverified: 1, suspended: 1 });

    const [bea] = await sql<{ status: string }[]>`
      select status::text from app.planning_org_users where full_name = 'Bea Varga'
    `;
    expect(bea?.status).toBe("suspended");
  });

  it("seeds every order the admin screen and the ops screen refer to", async () => {
    const rows = await sql<{ reference: string }[]>`
      select reference from app.planning_org_orders order by reference
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
      from app.planning_org_orders where reference = 'TO-4192'
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
      from app.planning_org_orders where reference = 'TO-4181'
    `;

    expect(order?.tax).toBe("0");
    expect(order?.subtotal).toBe(order?.total);
  });

  it("reconciles every order: subtotal + tax equals total", async () => {
    const rows = await sql<{ reference: string }[]>`
      select reference from app.planning_org_orders where subtotal + tax <> total
    `;
    expect(rows).toEqual([]);
  });

  it("reconciles every order: deposit + balance equals total", async () => {
    const rows = await sql<{ reference: string }[]>`
      select reference from app.planning_org_orders where deposit_amount + balance_amount <> total
    `;
    expect(rows).toEqual([]);
  });

  it("keeps the platform's commission off the vendor's tax", async () => {
    // Commission is 10% of the pre-tax subtotal, never of the total.
    const rows = await sql<{ reference: string }[]>`
      select reference from app.planning_org_orders
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
      from app.planning_org_orders o
      left join app.planning_org_transfers t on t.order_id = o.id and t.state <> 'reversed'
      where o.state in ('fulfilled', 'completed')
      group by o.id, o.reference, o.total, o.commission, o.commission_tax
      having (o.total - (coalesce(sum(t.amount), 0) + o.commission + o.commission_tax)) <> 0
    `;

    expect(rows).toEqual([]);
  });

  it("leaves no listing without a rating", async () => {
    // The column the catalogue's headline sort leads on. Nullable, an unrated
    // listing sorted above every rated business — `desc` puts NULLs first — and
    // a keyset page comparing a cursor against NULL matched neither side of the
    // boundary, so that row was unreachable at any offset.
    const [column] = await sql<{ is_nullable: string; column_default: string }[]>`
      select is_nullable, column_default
      from information_schema.columns
      where table_schema = 'app'
        and table_name = 'planning_org_services'
        and column_name = 'rating_average'
    `;

    expect(column?.is_nullable).toBe("NO");
    expect(column?.column_default).toBe("0");
  });

  it("holds a date for every seeded booking, and frees the cancelled one", async () => {
    // Without these rows the exclusion constraint has nothing to collide with,
    // so every seeded booking's date reads as free and can be booked a second
    // time — on a demo database whose whole job is to look like a platform that
    // has been running for a while.
    //
    // Both sides of the flag, because a seed that made every block active would
    // lose a cancelled booking's date for ever and nothing would say why.
    const [row] = await sql<{ blocks: string; active: string; inactive: string }[]>`
      select
        count(*)::text as blocks,
        count(*) filter (where active)::text as active,
        count(*) filter (where not active)::text as inactive
      from app.planning_org_capacity_blocks
    `;
    const [lines] = await sql<{ count: string }[]>`
      select count(*)::text as count
      from app.planning_org_order_items where service_id is not null
    `;

    expect(Number(row?.blocks)).toBe(Number(lines?.count));
    expect(Number(row?.inactive)).toBeGreaterThan(0);
    expect(Number(row?.active)).toBeGreaterThan(0);
  });

  it("gives every block the range of the event its order was placed against", async () => {
    // The same half-open range a checkout writes: local start to the next local
    // midnight, in the event's own zone. A block an hour out is one that admits
    // a second booking on a date the business is committed to.
    const rows = await sql<{ reference: string; agrees: boolean }[]>`
      select
        o.reference,
        cb.during = tstzrange(
          (e.event_date + coalesce(e.start_time, '00:00'::time)) at time zone e.timezone,
          (e.event_date + 1)::timestamp at time zone e.timezone,
          '[)'
        ) as agrees
      from app.planning_org_capacity_blocks cb
      join app.planning_org_orders o on o.id = cb.order_id
      join app.planning_org_events e on e.id = o.event_id
    `;

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.filter((row) => !row.agrees)).toEqual([]);
  });

  it("publishes eleven of the twelve services, leaving one a draft", async () => {
    // Both numbers, not just the first. Publication and vendor standing are two
    // separate conditions on every discovery query, and a seed that published
    // everything would leave the first satisfied by every row — so a test that
    // an unpublished service is absent would be asserting nothing. A seed that
    // published nothing empties the catalogue, which is the other half.
    const [row] = await sql<{ published: string; draft: string }[]>`
      select
        count(*) filter (where published_at is not null)::text as published,
        count(*) filter (where published_at is null)::text as draft
      from app.planning_org_services
    `;

    expect([Number(row?.published), Number(row?.draft)]).toEqual([11, 1]);
  });

  it("publishes every listing before the oldest booking against it was made", async () => {
    // Anchor-relative like every other seeded instant, and earlier than the
    // orders: a booking recorded against a listing that was not yet on sale is
    // a demo that contradicts its own rule.
    const rows = await sql<{ published_at: Date }[]>`
      select published_at from app.planning_org_services where published_at is not null
    `;
    const [earliest] = await sql<{ created_at: Date }[]>`
      select min(created_at) as created_at from app.planning_org_orders
    `;

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.published_at.getTime()).toBeLessThan(anchorAt.getTime());
      expect(row.published_at.getTime()).toBeLessThanOrEqual(
        (earliest as { created_at: Date }).created_at.getTime(),
      );
    }
  });

  it("gives a listing pictures only where somebody can see them", async () => {
    // Grouped off the table rather than counted by hand. What matters is the
    // spread: the card and the detail strip degrade in three different ways —
    // no pictures, exactly one, and more than the strip's four cells — and a
    // seed that gave every listing the same count would leave two of those
    // three exercised by nothing but a unit test over a literal array.
    const rows = await sql<{ slug: string; listable: boolean; pictures: string }[]>`
      select s.slug,
             (v.status = 'approved' and s.published_at is not null) as listable,
             count(m.id)::text as pictures
      from app.planning_org_services s
      join app.planning_org_vendors v on v.id = s.vendor_id
      left join app.planning_org_service_media m on m.service_id = s.id
      group by s.slug, listable
    `;

    const listable = rows.filter((row) => row.listable).map((row) => Number(row.pictures));
    const hidden = rows.filter((row) => !row.listable).map((row) => Number(row.pictures));

    expect(listable.length).toBeGreaterThan(0);
    expect(listable.filter((count) => count === 0)).toHaveLength(1);
    expect(listable.filter((count) => count === 1)).toHaveLength(1);
    // The strip shows four; the "+N" tile has a number to say only past that.
    expect(listable.filter((count) => count > 4)).toHaveLength(1);
    // Everything that is not one of those two deliberate exceptions carries a
    // carousel's worth: three dots on the card, a hero and two thumbnails on
    // the detail page.
    const rest = listable.filter((count) => count > 1);
    expect(rest).toHaveLength(listable.length - 2);
    expect(rest.filter((count) => count < 3)).toEqual([]);

    // A draft listing, and one whose business is not approved, are refused by
    // discovery and by the detail page alike. Pictures on them would be rows
    // with no reader.
    expect(hidden.length).toBeGreaterThan(0);
    expect(hidden.filter((count) => count > 0)).toEqual([]);
  });

  it("numbers a listing's pictures from zero without a gap", async () => {
    // The card pages by index and the strip slices by position, so a gap is a
    // blank frame and a first picture at 1 is a hero nothing selects.
    const rows = await sql<{ slug: string; pictures: string; lowest: string; highest: string }[]>`
      select s.slug,
             count(*)::text as pictures,
             min(m.sort_order)::text as lowest,
             max(m.sort_order)::text as highest
      from app.planning_org_service_media m
      join app.planning_org_services s on s.id = m.service_id
      group by s.slug
    `;

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect([row.slug, Number(row.lowest)]).toEqual([row.slug, 0]);
      expect([row.slug, Number(row.highest) + 1]).toEqual([row.slug, Number(row.pictures)]);
    }
  });

  it("captions a gallery big enough to browse, and lets the rest generate theirs", async () => {
    // Both branches of the alt text ship — a supplied caption and the one the
    // components build from the title and the position — so both need rows.
    const [row] = await sql<{ captioned: string; generated: string }[]>`
      select
        count(*) filter (where alt_text is not null)::text as captioned,
        count(*) filter (where alt_text is null)::text as generated
      from app.planning_org_service_media
    `;

    expect(Number(row?.captioned)).toBeGreaterThan(0);
    expect(Number(row?.generated)).toBeGreaterThan(0);
  });

  it("closes a business only on a day somebody is planning, and only one a customer can ask about", async () => {
    // A blackout on any other date is invisible: the service page asks about
    // the active event's own day, so a closed day that falls on none of them
    // is a row that answers nobody. And the availability read refuses outright
    // for a business that is not approved or a listing that is not published,
    // so a blackout on one of those never gets as far as being consulted.
    const rows = await sql<{ vendor: string; planned: boolean; listable: boolean }[]>`
      select v.slug as vendor,
             exists (select 1 from app.planning_org_events e where e.event_date = b.day) as planned,
             exists (
               select 1 from app.planning_org_services s
               where s.vendor_id = b.vendor_id and s.published_at is not null
             ) and v.status = 'approved' as listable
      from app.planning_org_blackout_dates b
      join app.planning_org_vendors v on v.id = b.vendor_id
    `;

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.filter((row) => !row.planned)).toEqual([]);
    expect(rows.filter((row) => !row.listable)).toEqual([]);
  });

  it("puts all three availability answers on one date", async () => {
    // Free, booked and closed, on the same day and on listings a stranger can
    // open. Two of the three had rows before this seed; a demo where the third
    // never happens is a screen state nobody has ever seen.
    const [day] = await sql<{ event_date: string }[]>`
      select event_date::text from app.planning_org_events where name = 'Sarah''s 30th'
    `;

    const rows = await sql<{ slug: string; closed: boolean; held: boolean }[]>`
      select s.slug,
             exists (
               select 1 from app.planning_org_blackout_dates b
               where b.vendor_id = s.vendor_id and b.day = ${day?.event_date as string}
             ) as closed,
             exists (
               select 1 from app.planning_org_capacity_blocks cb
               where cb.service_id = s.id and cb.active
                 and cb.during && tstzrange(
                   (${day?.event_date as string}::date)::timestamp at time zone 'America/Toronto',
                   (${day?.event_date as string}::date + 1)::timestamp at time zone 'America/Toronto',
                   '[)')
             ) as held
      from app.planning_org_services s
      join app.planning_org_vendors v on v.id = s.vendor_id
      where v.status = 'approved' and s.published_at is not null
    `;

    // Closed wins over held in the read, so the three groups are counted the
    // way the answer is decided rather than as three independent flags.
    const closed = rows.filter((row) => row.closed);
    const booked = rows.filter((row) => !row.closed && row.held);
    const free = rows.filter((row) => !row.closed && !row.held);

    expect(closed.length).toBeGreaterThan(0);
    expect(booked.length).toBeGreaterThan(0);
    expect(free.length).toBeGreaterThan(0);
  });

  it("seeds at least one open quote request so the expiry job has work", async () => {
    const [row] = await sql<{ count: string }[]>`
      select count(*)::text as count from app.planning_org_quote_requests where state = 'open'
    `;
    expect(Number(row?.count ?? "0")).toBeGreaterThan(0);
  });

  it("schedules exactly one cooling-window transfer at the 48 hour mark", async () => {
    const rows = await sql<{ run_after: Date }[]>`
      select run_after from app.planning_org_jobs where type = 'cooling_window_transfer'
    `;

    expect(rows).toHaveLength(1);
    const offsetHours =
      ((rows[0] as { run_after: Date }).run_after.getTime() - anchorAt.getTime()) / HOUR;
    expect(Math.round(offsetHours)).toBe(48);
  });

  it("schedules the balance charges fourteen days before the event", async () => {
    const rows = await sql<{ reference: string; run_after: Date; event_date: string }[]>`
      select o.reference, j.run_after, e.event_date::text
      from app.planning_org_jobs j
      join app.planning_org_orders o on o.id = (j.payload ->> 'orderId')::uuid
      join app.planning_org_events e on e.id = o.event_id
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
      select run_after from app.planning_org_jobs where type = 'cooling_window_transfer'
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
      select id, email from app.planning_org_users where full_name = 'Sarah Mensah'
    `;
    const [order] = await sql<{ id: string }[]>`
      select id from app.planning_org_orders where reference = 'TO-4192'
    `;

    await sql`insert into app.planning_org_threads (order_id, subject) values (${order?.id as string}, 'Test')`;
    const [thread] = await sql<{ id: string }[]>`
      select id from app.planning_org_threads where subject = 'Test'
    `;
    await sql`
      insert into app.planning_org_thread_participants (thread_id, user_id)
      values (${thread?.id as string}, ${user?.id as string})
    `;
    await sql`
      insert into app.planning_org_messages (thread_id, sender_user_id, body)
      values (${thread?.id as string}, ${user?.id as string}, 'private message body')
    `;
    await sql`
      insert into app.planning_org_audit_log (actor_user_id, action, entity_type)
      values (${user?.id as string}, 'vendor.approve', 'vendor')
    `;
    await sql`
      insert into app.planning_org_email_sends (to_email, subject, idempotency_key, recipient_user_id)
      values (${user?.email as string}, 'Hello', 'test-key-1', ${user?.id as string})
    `;

    await reseedDemoData(dbUrl, anchorAt);

    for (const table of ["threads", "thread_participants", "messages", "audit_log"]) {
      const [row] = await sql.unsafe<{ count: string }[]>(
        `select count(*)::text as count from app.planning_org_${table}`,
      );
      expect(Number(row?.count ?? "0"), `${table} should be empty after a reseed`).toBe(0);
    }

    const leftovers = await sql<{ to_email: string }[]>`
      select to_email from app.planning_org_email_sends
    `;
    expect(leftovers).toEqual([]);

    // And the demo data is actually back.
    const [orders] = await sql<{ count: string }[]>`
      select count(*)::text as count from app.planning_org_orders
    `;
    expect(Number(orders?.count ?? "0")).toBe(7);
  }, 60_000);

  it("produces the same ids on every reseed", async () => {
    const before = await sql<{ id: string }[]>`
      select id from app.planning_org_orders order by reference
    `;

    await resetDatabase(dbUrl, anchorAt);

    const after = await sql<{ id: string }[]>`
      select id from app.planning_org_orders order by reference
    `;

    expect(after).toEqual(before);
  }, 60_000);
});
