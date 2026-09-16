import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asRole, ownerSql, resetDatabase, testDatabaseUrl } from "./harness.js";

/**
 * Row-level security is enabled on every table with no policies, which denies
 * everything by default, and the application role is exempted so the service
 * layer can remain the single authorization boundary.
 *
 * That arrangement has a failure mode worth testing directly: if the exemption
 * is lost, the application reads zero rows from every table and the symptom is
 * a demo where nothing exists. These assertions enumerate `pg_tables` rather
 * than a hand-written list, so a future migration that adds a table without a
 * grant fails here instead of in production.
 */

const url = testDatabaseUrl();

describe.skipIf(!url)("row-level security", () => {
  const dbUrl = url as string;
  let tables: string[] = [];

  beforeAll(async () => {
    await resetDatabase(dbUrl);

    const sql = ownerSql(dbUrl);
    try {
      const rows = await sql<{ tablename: string }[]>`
        select tablename from pg_tables
        where schemaname = 'app' and tablename <> '__migrations'
        order by tablename
      `;
      tables = rows.map((row) => row.tablename);
    } finally {
      await sql.end({ timeout: 5 });
    }
  }, 120_000);

  afterAll(() => {
    expect(tables.length).toBeGreaterThan(30);
  });

  it("enables RLS on every application table", async () => {
    const sql = ownerSql(dbUrl);
    try {
      const rows = await sql<{ tablename: string }[]>`
        select c.relname as tablename
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'app' and c.relkind = 'r'
          and c.relname <> '__migrations' and c.relrowsecurity = false
      `;
      expect(rows.map((row) => row.tablename)).toEqual([]);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("leaves the migration ledger out of RLS and out of the app role's reach", async () => {
    const sql = ownerSql(dbUrl);
    try {
      // The ledger is the migrator's, not application data: RLS on it would
      // hide it from a future migrator, and a DELETE grant would let the
      // application rewrite migration history.
      const [meta] = await sql<{ rowsecurity: boolean }[]>`
        select relrowsecurity as rowsecurity from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'app' and c.relname = '__migrations'
      `;
      expect(meta?.rowsecurity).toBe(false);

      const grants = await sql<{ grantee: string }[]>`
        select grantee from information_schema.role_table_grants
        where table_schema = 'app' and table_name = '__migrations' and grantee = 'app_rw'
      `;
      expect(grants).toEqual([]);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("defines no policies, so the default is deny", async () => {
    const sql = ownerSql(dbUrl);
    try {
      const [row] = await sql<{ count: string }[]>`
        select count(*)::text as count from pg_policies where schemaname = 'app'
      `;
      expect(row?.count).toBe("0");
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("lets the application role read every application table", async () => {
    const failures: string[] = [];

    await asRole(dbUrl, "app_rw", async (sql) => {
      for (const table of tables) {
        try {
          await sql.unsafe(`select count(*) from app.${table}`);
        } catch (error) {
          failures.push(`${table}: ${(error as Error).message}`);
        }
      }
    });

    expect(failures).toEqual([]);
  });

  it("returns seeded rows to the application role, not an empty result", async () => {
    // The distinction matters: losing the RLS exemption makes every table
    // readable and empty, which no permission error would reveal.
    await asRole(dbUrl, "app_rw", async (sql) => {
      for (const table of ["users", "vendors", "services", "orders", "payments", "jobs"]) {
        const [row] = await sql.unsafe<{ count: string }[]>(
          `select count(*)::text as count from app.${table}`,
        );
        expect(Number(row?.count ?? "0"), `app_rw should see rows in app.${table}`).toBeGreaterThan(
          0,
        );
      }
    });
  });

  it("denies anon and authenticated on every application table", async () => {
    for (const role of ["anon", "authenticated"]) {
      const allowed: string[] = [];

      await asRole(dbUrl, role, async (sql) => {
        for (const table of tables) {
          try {
            await sql.unsafe(`select count(*) from app.${table}`);
            allowed.push(table);
          } catch {
            // Expected: no usage on the schema, no grants on the table.
          }
        }
      });

      expect(allowed, `${role} should reach nothing`).toEqual([]);
    }
  });

  it("grants anon and authenticated nothing on any app table", async () => {
    const sql = ownerSql(dbUrl);
    try {
      const rows = await sql<{ grantee: string; table_name: string }[]>`
        select grantee, table_name
        from information_schema.role_table_grants
        where table_schema = 'app' and grantee in ('anon', 'authenticated', 'PUBLIC')
      `;
      expect(rows).toEqual([]);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });
});
