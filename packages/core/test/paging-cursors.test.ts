import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import type postgres from "postgres";
import { contentReports, disputes, orders, users } from "@occasion/db/schema";
import type { CoreContext } from "../src/context.js";
import { PAGE_SIZE, SORTS, encodeCursor } from "../src/paging.js";
import { listForAdmin as listDisputes } from "../src/disputes/repo.js";
import { listReports } from "../src/moderation/repo.js";
import { createDatabaseContext, ownerSql, resetDatabase, testDatabaseUrl } from "./harness.js";

/**
 * The two queues page, and page correctly, against a real database.
 *
 * They are the lists with the least cover: every other caller of the shared
 * cursor is exercised by a suite that actually asks for a second page, and
 * these two were only ever asked for their first. That matters more than it
 * looks, because the rows this file writes all share one `now()` — which is the
 * case the id tiebreak exists for, and the case a cursor that went through a
 * JavaScript `Date` makes unreachable at any page.
 *
 * Walking to the end rather than fetching two pages: a boundary bug shows up as
 * a row seen twice or not at all, and only the whole walk can say that.
 */

const url = testDatabaseUrl();

/** Enough to force three pages, so a bug at a boundary has two chances to show. */
const EXTRA_ROWS = PAGE_SIZE * 2 + 3;

describe.skipIf(!url)("queue paging", () => {
  const dbUrl = url as string;
  let sql2: postgres.Sql;
  let database: ReturnType<typeof createDatabaseContext>;
  let ctx: CoreContext;

  beforeAll(async () => {
    await resetDatabase(dbUrl);
    sql2 = ownerSql(dbUrl);
    database = createDatabaseContext(dbUrl);
    ctx = database.ctx;

    const [order] = await ctx.db.select({ id: orders.id }).from(orders).limit(1);
    const [reporter] = await ctx.db.select({ id: users.id }).from(users).limit(1);

    expect(order?.id, "the seed has an order to complain about").toBeTruthy();

    // One statement each, so every row shares `now()` to the microsecond.
    await ctx.db.insert(disputes).values(
      Array.from({ length: EXTRA_ROWS }, (_unused, index) => ({
        orderId: order?.id as string,
        reason: `Bulk complaint ${index}`,
      })),
    );

    await ctx.db.insert(contentReports).values(
      Array.from({ length: EXTRA_ROWS }, (_unused, index) => ({
        targetType: "review" as const,
        // A distinct target per row: one person may hold only one open report
        // against a given piece of content, and the target is polymorphic with
        // no foreign key, so an id nothing owns is a legal queue entry.
        targetId: crypto.randomUUID(),
        reporterUserId: reporter?.id ?? null,
        reason: `Bulk report ${index}`,
      })),
    );
  }, 180_000);

  afterAll(async () => {
    await database?.close();
    await sql2?.end({ timeout: 5 });
  });

  /** Every page in turn, following the cursor until there is none. */
  async function walk(
    page: (cursor?: string) => Promise<{ rows: { id: string }[]; nextCursor?: string | undefined }>,
  ): Promise<string[]> {
    const seen: string[] = [];
    let cursor: string | undefined;

    do {
      const result = await page(cursor);
      expect(result.rows.length, "a page is never longer than the page size").toBeLessThanOrEqual(
        PAGE_SIZE,
      );
      seen.push(...result.rows.map((row) => row.id));
      cursor = result.nextCursor;
      // A cursor that does not advance would loop for ever rather than fail.
      expect(seen.length).toBeLessThanOrEqual(EXTRA_ROWS + PAGE_SIZE * 4);
    } while (cursor);

    return seen;
  }

  async function countOf(table: typeof disputes | typeof contentReports): Promise<number> {
    const [row] = await ctx.db.select({ total: sql<number>`count(*)::int` }).from(table);
    return row?.total ?? 0;
  }

  it("reaches every complaint exactly once", async () => {
    const seen = await walk((cursor) => listDisputes(ctx.db, cursor ? { cursor } : {}));

    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.length).toBe(await countOf(disputes));
    expect(seen.length).toBeGreaterThan(PAGE_SIZE);
  });

  it("reaches every report exactly once", async () => {
    const seen = await walk((cursor) => listReports(ctx.db, cursor ? { cursor } : {}));

    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.length).toBe(await countOf(contentReports));
    expect(seen.length).toBeGreaterThan(PAGE_SIZE);
  });

  it("keeps a filter across the page boundary", async () => {
    // The cursor is a position in a filtered list, not in the table. Dropping
    // the filter on the second page is the classic way a queue shows a decided
    // report again.
    const seen = await walk((cursor) =>
      listReports(ctx.db, { open: true, ...(cursor ? { cursor } : {}) }),
    );

    expect(new Set(seen).size).toBe(seen.length);
    const [row] = await ctx.db
      .select({ total: sql<number>`count(*)::int` })
      .from(contentReports)
      .where(sql`${contentReports.decidedAt} is null`);
    expect(seen.length).toBe(row?.total ?? 0);
  });

  it("starts again when handed the other queue's cursor", async () => {
    // Both queues are oldest-first over a `timestamptz`, so the two cursors are
    // the same shape and only the sort identity separates them. Without it this
    // would silently resume one queue from a position in the other.
    const first = await listDisputes(ctx.db);
    expect(first.nextCursor).toBeDefined();

    const replayed = await listReports(ctx.db, { cursor: first.nextCursor as string });
    const start = await listReports(ctx.db);

    expect(replayed.rows.map((row) => row.id)).toEqual(start.rows.map((row) => row.id));
  });

  it("starts again when handed a cursor nobody produced", async () => {
    const start = await listDisputes(ctx.db);

    for (const cursor of [
      "not-a-cursor",
      encodeCursor(SORTS.usersByName, { value: "Sarah Mensah", id: crypto.randomUUID() }),
      `disputes-oldest|yesterday|${crypto.randomUUID()}`,
      `disputes-oldest|2026-09-18 19:19:00+00|' or true--`,
    ]) {
      const page = await listDisputes(ctx.db, { cursor });
      expect(
        page.rows.map((row) => row.id),
        cursor,
      ).toEqual(start.rows.map((row) => row.id));
    }
  });
});
