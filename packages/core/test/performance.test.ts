import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type postgres from "postgres";
import type { CoreContext } from "../src/context.js";
import type { Actor } from "../src/identity/actor.js";
import { getActor } from "../src/identity/service.js";
import { listUsersForAdmin } from "../src/identity/admin-service.js";
import { listVendorsForAdmin } from "../src/vendors/service.js";
import { listOrdersForAdmin, listOrderVendors } from "../src/ordering/admin-service.js";
import { getOpsView } from "../src/jobs/admin-service.js";
import { getEmailView } from "../src/email/service.js";
import { createDatabaseContext, ownerSql, resetDatabase, testDatabaseUrl } from "./harness.js";

/**
 * The admin lists do not get slower one row at a time.
 *
 * An N+1 is invisible in an assertion about what a list returns: the answer is
 * correct either way, and on seeded data — six vendors, six orders — it is also
 * fast. It shows up at a thousand accounts, in production, months later, as a
 * screen that has become unusable without anybody having changed it.
 *
 * So the claim asserted here is not a duration. It is that **the number of
 * queries does not move when the number of rows does**: each list is run
 * against the seed and then against a thousand accounts and five hundred
 * orders, and the two counts have to be equal. A per-row query fails that by
 * construction, and no timing threshold has to be guessed at.
 *
 * A duration budget is asserted as well, generously, because a query count can
 * stay flat while a missing index turns one of them into a sequential scan.
 * It is a smoke alarm, not a benchmark: a laptop and a CI runner disagree by
 * more than any useful threshold.
 */

const url = testDatabaseUrl();

/** What the admin screens ask for, each one run at both sizes. */
type Screen = {
  name: string;
  run: (ctx: CoreContext, actor: Actor) => Promise<unknown>;
};

const SCREENS: readonly Screen[] = [
  { name: "users · first page", run: (ctx, actor) => listUsersForAdmin(ctx, actor, {}) },
  {
    name: "users · searched",
    run: (ctx, actor) => listUsersForAdmin(ctx, actor, { search: "load" }),
  },
  { name: "vendors", run: (ctx, actor) => listVendorsForAdmin(ctx, actor, {}) },
  { name: "orders · first page", run: (ctx, actor) => listOrdersForAdmin(ctx, actor, {}) },
  {
    name: "orders · filtered by state",
    run: (ctx, actor) => listOrdersForAdmin(ctx, actor, { state: "confirmed" }),
  },
  { name: "orders · vendor filter options", run: (ctx, actor) => listOrderVendors(ctx, actor) },
  { name: "automations", run: (ctx, actor) => getOpsView(ctx, actor) },
  { name: "email", run: (ctx, actor) => getEmailView(ctx, actor, {}) },
];

/** The page budget. Every list is a keyset page, so this is also the row cap. */
const BUDGET_MS = 1_500;

describe.skipIf(!url)("admin list performance", () => {
  const dbUrl = url as string;
  let sql: postgres.Sql;
  let database: ReturnType<typeof createDatabaseContext>;
  let ctx: CoreContext;
  let admin: Actor;

  let queries: string[] = [];

  /** Query count and wall time for one screen, at whatever size the data is. */
  async function measure(screen: Screen): Promise<{ count: number; ms: number }> {
    queries = [];
    const started = performance.now();
    await screen.run(ctx, admin);
    return { count: queries.length, ms: performance.now() - started };
  }

  const seeded = new Map<string, number>();
  const loaded = new Map<string, { count: number; ms: number }>();

  beforeAll(async () => {
    await resetDatabase(dbUrl);
    sql = ownerSql(dbUrl);
    database = createDatabaseContext(dbUrl, undefined, (query) => queries.push(query));
    ctx = database.ctx;

    await sql`update app.planning_org_users set auth_provider_sub = 'provider-sub-' || email`;
    database.setUser({
      id: "provider-sub-admin@occasion.test",
      email: "admin@occasion.test",
      issuedAt: new Date(),
      emailVerified: true,
      secondFactorVerified: true,
    });
    admin = await getActor(ctx, {});

    for (const screen of SCREENS) {
      seeded.set(screen.name, (await measure(screen)).count);
    }

    // A thousand accounts and five hundred orders, written as rows rather than
    // booked through the domain: this is a claim about reading, and five
    // hundred checkouts would take longer than the suite is worth. The
    // references and addresses are distinct because both are unique, and the
    // orders are spread across the seeded vendors so no single filter sees all
    // of them.
    await sql`
      insert into app.planning_org_users (full_name, email, status, email_verified_at)
      select
        'Load Test ' || n,
        'load-' || n || '@example.ca',
        (array['active', 'pending', 'unverified', 'suspended'])[1 + (n % 4)]::app.user_status,
        case when n % 4 = 2 then null else now() end
      from generate_series(1, 1000) as n
    `;
    await sql`
      insert into app.planning_org_user_roles (user_id, role)
      select id, 'customer' from app.planning_org_users where email like 'load-%'
    `;

    await sql`
      insert into app.planning_org_orders (
        reference, user_id, vendor_id, state,
        subtotal, tax, total, commission, commission_tax,
        deposit_amount, balance_amount, currency, created_at
      )
      select
        'LT-' || n,
        (select id from app.planning_org_users where email = 'load-' || (1 + (n % 1000)) || '@example.ca'),
        vendors.id,
        (array['confirmed', 'fulfilled', 'completed', 'cancelled', 'action_required'])[1 + (n % 5)]::app.order_state,
        10000, 1300, 11300, 1000, 130, 2260, 9040, 'CAD',
        now() - (n || ' minutes')::interval
      from generate_series(1, 500) as n
      cross join lateral (
        select id from app.planning_org_vendors where status = 'approved'
        order by md5(id::text || n::text) limit 1
      ) as vendors
    `;

    for (const screen of SCREENS) {
      loaded.set(screen.name, await measure(screen));
    }
  }, 300_000);

  afterAll(async () => {
    // Put the database back. Every suite here resets in `beforeAll`, so the
    // next vitest file would not notice — but the E2E suite runs afterwards
    // against the same stack, and fifteen hundred rows that are not demo data
    // are exactly what stops a demo reseed.
    await resetDatabase(dbUrl);
    await database?.close();
    await sql?.end({ timeout: 5 });
  }, 120_000);

  it("actually loaded the data", async () => {
    // Without this, a failed bulk insert would leave both measurements taken
    // against the seed, and every case below would pass by measuring nothing.
    const [users] = await sql<{ count: number }[]>`
      select count(*)::int as count from app.planning_org_users
    `;
    const [orders] = await sql<{ count: number }[]>`
      select count(*)::int as count from app.planning_org_orders
    `;

    expect(users?.count).toBeGreaterThanOrEqual(1000);
    expect(orders?.count).toBeGreaterThanOrEqual(500);
  });

  it.each(SCREENS.map((screen) => screen.name))(
    "%s issues the same number of queries at a thousand accounts as at six",
    (name) => {
      // Both counts being zero would satisfy the equality below while proving
      // nothing at all, which is what an unwired query hook looks like.
      expect(seeded.get(name), `${name} issued no queries`).toBeGreaterThan(0);
      expect(loaded.get(name)?.count).toBe(seeded.get(name));
    },
  );

  it.each(SCREENS.map((screen) => screen.name))("%s stays inside the page budget", (name) => {
    expect(loaded.get(name)?.ms).toBeLessThan(BUDGET_MS);
  });

  it("pages rather than returning everything", async () => {
    // A flat query count is also what a list that selects every row looks like.
    const users = await listUsersForAdmin(ctx, admin, {});
    const orders = await listOrdersForAdmin(ctx, admin, {});

    expect(users.rows.length).toBeLessThanOrEqual(100);
    expect(users.total).toBeGreaterThanOrEqual(1000);
    expect(orders.rows.length).toBeLessThanOrEqual(100);
    expect(orders.total).toBeGreaterThanOrEqual(500);
    expect(users.nextCursor).toBeDefined();
    expect(orders.nextCursor).toBeDefined();
  });

  it("reaches the second page without rereading the first", async () => {
    const first = await listOrdersForAdmin(ctx, admin, {});
    queries = [];
    const second = await listOrdersForAdmin(ctx, admin, { cursor: first.nextCursor });

    expect(queries.length).toBeGreaterThan(0);
    expect(second.rows.length).toBeGreaterThan(0);
    expect(second.rows[0]?.id).not.toBe(first.rows[0]?.id);
    // A keyset cursor, not an offset: the page after the ten-thousandth row
    // costs the same as the page after the first, and an offset does not.
    expect(queries.some((query) => /offset/i.test(query))).toBe(false);
  });
});
