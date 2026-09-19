import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type postgres from "postgres";
import { ownerSql, resetDatabase, testDatabaseUrl } from "./harness.js";

/**
 * Constraints that have to hold under concurrency, and therefore have to live
 * in the database rather than in a service that checked a moment ago.
 */

const url = testDatabaseUrl();

describe.skipIf(!url)("database constraints", () => {
  const dbUrl = url as string;
  let sql: postgres.Sql;

  beforeAll(async () => {
    await resetDatabase(dbUrl);
    sql = ownerSql(dbUrl);
  }, 60_000);

  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });

  async function firstServiceId(): Promise<string> {
    const [row] = await sql<
      { id: string }[]
    >`select id from app.planning_org_services order by id limit 1`;
    return row?.id as string;
  }

  it("rejects two active capacity blocks that overlap for one service", async () => {
    const serviceId = await firstServiceId();

    await sql`
      insert into app.planning_org_capacity_blocks (service_id, during, active)
      values (${serviceId}, tstzrange('2027-03-20 17:00+00', '2027-03-20 21:00+00'), true)
    `;

    // Starts inside the first block: this is the double booking.
    await expect(
      sql`
        insert into app.planning_org_capacity_blocks (service_id, during, active)
        values (${serviceId}, tstzrange('2027-03-20 19:00+00', '2027-03-20 23:00+00'), true)
      `,
    ).rejects.toThrow(/capacity_blocks_no_overlap|conflicting key value/i);
  });

  it("allows a touching block, because the range is half-open", async () => {
    const serviceId = await firstServiceId();

    await expect(
      sql`
        insert into app.planning_org_capacity_blocks (service_id, during, active)
        values (${serviceId}, tstzrange('2027-03-20 21:00+00', '2027-03-21 01:00+00'), true)
      `,
    ).resolves.toBeDefined();
  });

  it("allows an overlapping block once the first is released", async () => {
    const serviceId = await firstServiceId();

    await sql`
      insert into app.planning_org_capacity_blocks (service_id, during, active)
      values (${serviceId}, tstzrange('2027-06-01 10:00+00', '2027-06-01 14:00+00'), false)
    `;

    await expect(
      sql`
        insert into app.planning_org_capacity_blocks (service_id, during, active)
        values (${serviceId}, tstzrange('2027-06-01 12:00+00', '2027-06-01 16:00+00'), true)
      `,
    ).resolves.toBeDefined();
  });

  it("refuses a second transfer of the same kind for one order", async () => {
    const [order] = await sql<{ id: string; vendor_id: string }[]>`
      select id, vendor_id from app.planning_org_orders where reference = 'TO-4192'
    `;

    await expect(
      sql`
        insert into app.planning_org_transfers (order_id, vendor_id, kind, amount)
        values (${order?.id as string}, ${order?.vendor_id as string}, 'deposit_share', 100)
        , (${order?.id as string}, ${order?.vendor_id as string}, 'deposit_share', 100)
      `,
    ).rejects.toThrow(/transfers_order_kind_key/i);
  });

  it("refuses a second queued job with the same type and dedupe key", async () => {
    // Read from the seeded row rather than written out here: the key's shape is
    // the ordering domain's to decide, and a test that restates it goes on
    // passing against a key nothing else uses any more.
    const [job] = await sql<{ type: string; dedupe_key: string }[]>`
      select type, dedupe_key from app.planning_org_jobs where type = 'charge_balance' limit 1
    `;

    // Asserted rather than asserted-away: without a seeded job the insert below
    // fails on a NOT NULL violation, and the test would report the wrong thing.
    expect(job).toBeDefined();

    await expect(
      sql`
        insert into app.planning_org_jobs (type, dedupe_key, run_after, payload)
        values (${job?.type as string}, ${job?.dedupe_key as string}, now(), '{}'::jsonb)
      `,
    ).rejects.toThrow(/jobs_type_dedupe_key/i);
  });

  it("refuses a second review for the same order", async () => {
    const [order] = await sql<{ id: string; user_id: string; vendor_id: string }[]>`
      select id, user_id, vendor_id from app.planning_org_orders where reference = 'TO-4165'
    `;

    // The seed writes the first one — TO-4165 is the completed order, and a
    // review is what completion unlocks. Asserted rather than assumed: if it
    // ever stops being seeded, the insert below becomes the first review and
    // this test would pass by rejecting a row that should have been accepted.
    const [existing] = await sql<{ total: string }[]>`
      select count(*)::text as total from app.planning_org_reviews
      where order_id = ${order?.id as string}
    `;
    expect(existing?.total).toBe("1");

    await expect(
      sql`
        insert into app.planning_org_reviews (order_id, author_user_id, vendor_id, rating)
        values (${order?.id as string}, ${order?.user_id as string}, ${order?.vendor_id as string}, 1)
      `,
    ).rejects.toThrow(/reviews_order_key/i);
  });

  it("refuses negative remaining capacity", async () => {
    const serviceId = await firstServiceId();

    await expect(
      sql`
        insert into app.planning_org_daily_capacity (service_id, day, total, remaining)
        values (${serviceId}, '2027-03-20', 10, -1)
      `,
    ).rejects.toThrow(/daily_capacity_remaining_non_negative/i);
  });

  it("refuses a duplicate provider event id", async () => {
    await sql`
      insert into app.planning_org_stripe_events (event_id, type, payload)
      values ('evt_test_duplicate', 'payment_intent.succeeded', '{}'::jsonb)
    `;

    await expect(
      sql`
        insert into app.planning_org_stripe_events (event_id, type, payload)
        values ('evt_test_duplicate', 'payment_intent.succeeded', '{}'::jsonb)
      `,
    ).rejects.toThrow(/stripe_events_event_id_unique|duplicate key/i);
  });

  describe("one live admin invitation per address", () => {
    async function invite(email: string, token: string) {
      const [admin] = await sql<{ id: string }[]>`
        select id from app.planning_org_users where email = 'admin@occasion.test'
      `;
      return sql`
        insert into app.planning_org_admin_invites (email, token, invited_by_user_id, expires_at)
        values (${email}, ${token}, ${admin?.id as string}, now() + interval '3 days')
      `;
    }

    it("refuses a second live invitation to the same address", async () => {
      // The service revokes any outstanding invitation before it writes a new
      // one, and under `read committed` two concurrent requests both do that
      // against snapshots missing each other's row. So the service cannot be
      // what enforces this, and the index has to be.
      await invite("one.live@occasion.test", "hash-one");

      await expect(invite("one.live@occasion.test", "hash-two")).rejects.toThrow(
        /admin_invites_one_live_per_email|duplicate key/i,
      );
    });

    it("allows a new invitation once the first is revoked", async () => {
      // Partial, so the uniqueness is about invitations still in play. An
      // address that was invited and revoked can be invited again, and both
      // rows stay in the table as the history of what was sent.
      await invite("revoked.then@occasion.test", "hash-three");
      await sql`
        update app.planning_org_admin_invites set revoked_at = now()
        where email = 'revoked.then@occasion.test'
      `;

      await expect(invite("revoked.then@occasion.test", "hash-four")).resolves.toBeDefined();

      const [count] = await sql<{ total: number }[]>`
        select count(*)::int as total from app.planning_org_admin_invites
        where email = 'revoked.then@occasion.test'
      `;
      expect(count?.total).toBe(2);
    });

    it("allows a new invitation once the first is accepted", async () => {
      await invite("accepted.then@occasion.test", "hash-five");
      await sql`
        update app.planning_org_admin_invites set accepted_at = now()
        where email = 'accepted.then@occasion.test'
      `;

      await expect(invite("accepted.then@occasion.test", "hash-six")).resolves.toBeDefined();
    });
  });
  describe("a closed dispute says how it closed", () => {
    async function disputeId(): Promise<string> {
      const [row] = await sql<{ id: string }[]>`
        select id from app.planning_org_disputes order by created_at limit 1
      `;
      return row?.id as string;
    }

    it("refuses a resolved case with no resolution", async () => {
      await expect(
        sql`update app.planning_org_disputes set state = 'resolved' where id = ${await disputeId()}`,
      ).rejects.toThrow(/disputes_resolution_matches_state/i);
    });

    it("refuses an open case that claims one", async () => {
      // The other direction, and the one a screen produces: an outcome written
      // without the state moving leaves a case in the queue that reads as
      // settled.
      await expect(
        sql`update app.planning_org_disputes set resolution = 'vendor_warned' where id = ${await disputeId()}`,
      ).rejects.toThrow(/disputes_resolution_matches_state/i);
    });

    it("refuses a dismissal that is not a rejection, and a rejection that is not a dismissal", async () => {
      const id = await disputeId();

      await expect(
        sql`update app.planning_org_disputes set state = 'resolved', resolution = 'dismissed' where id = ${id}`,
      ).rejects.toThrow(/disputes_resolution_matches_state/i);

      await expect(
        sql`update app.planning_org_disputes set state = 'rejected', resolution = 'refund_recorded' where id = ${id}`,
      ).rejects.toThrow(/disputes_resolution_matches_state/i);
    });

    it("accepts the two shapes that mean something", async () => {
      const id = await disputeId();

      await expect(
        sql`update app.planning_org_disputes set state = 'rejected', resolution = 'dismissed' where id = ${id}`,
      ).resolves.toBeDefined();

      await expect(
        sql`update app.planning_org_disputes set state = 'resolved', resolution = 'refund_recorded' where id = ${id}`,
      ).resolves.toBeDefined();
    });
  });

  describe("one open report per person per item", () => {
    async function report(targetId: string, reporterId: string) {
      return sql`
        insert into app.planning_org_content_reports (target_type, target_id, reporter_user_id, reason)
        values ('review', ${targetId}, ${reporterId}, 'duplicate submission')
        returning id
      `;
    }

    it("refuses the second of two identical open reports", async () => {
      // A double-submitted form is the ordinary way to produce these. Reading
      // first and inserting second does not close it: under `read committed`
      // both requests find nothing and both insert.
      const [review] = await sql<{ id: string }[]>`
        select id from app.planning_org_reviews limit 1
      `;
      const [reporter] = await sql<{ id: string }[]>`
        select id from app.planning_org_users where email = 'jonah.tran@example.ca'
      `;

      await expect(report(review?.id as string, reporter?.id as string)).resolves.toBeDefined();
      await expect(report(review?.id as string, reporter?.id as string)).rejects.toThrow(
        /content_reports_one_open_per_reporter/i,
      );
    });

    it("allows the same content to be reported again once a decision is taken", async () => {
      const [review] = await sql<{ id: string }[]>`
        select id from app.planning_org_reviews limit 1
      `;
      const [reporter] = await sql<{ id: string }[]>`
        select id from app.planning_org_users where email = 'dae@kimchikart.ca'
      `;

      await report(review?.id as string, reporter?.id as string);
      await sql`
        update app.planning_org_content_reports
           set decision = 'keep', decided_at = now()
         where reporter_user_id = ${reporter?.id as string}
      `;

      // The case where a second look really is warranted: the content was left
      // up, and something about it has changed since.
      await expect(report(review?.id as string, reporter?.id as string)).resolves.toBeDefined();
    });

    it("refuses half a decision", async () => {
      const [row] = await sql<{ id: string }[]>`
        select id from app.planning_org_content_reports where decided_at is null limit 1
      `;

      await expect(
        sql`update app.planning_org_content_reports set decision = 'hide' where id = ${row?.id as string}`,
      ).rejects.toThrow(/content_reports_decided_together/i);
    });
  });
});
