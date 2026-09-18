import postgres from "postgres";
import { reset } from "../src/reset.js";
import { reseedDemo } from "../src/demo.js";

/**
 * Shared setup for tests that need a real database.
 *
 * These tests assert things only a real Postgres can decide — that an exclusion
 * constraint rejects an overlap, that row-level security denies a role. A fake
 * would assert that the fake works.
 *
 * `TEST_DATABASE_URL` points at a throwaway database. When it is unset the
 * suites that need it skip rather than fail, so `pnpm test` still passes on a
 * machine with no Postgres; CI sets it, which is where the guarantee lives.
 */

export function testDatabaseUrl(): string | undefined {
  return process.env["TEST_DATABASE_URL"];
}

/** A connection as the unrestricted owner, used to set up fixtures. */
export function ownerSql(url: string) {
  return postgres(url, { max: 1, prepare: false, onnotice: () => {} });
}

/**
 * A connection as a named role, for asserting what that role can actually see.
 *
 * `SET ROLE` rather than a second connection string: it exercises the same
 * grants without needing a password for every role in the test environment.
 */
export async function asRole<T>(
  url: string,
  role: string,
  run: (sql: postgres.Sql) => Promise<T>,
): Promise<T> {
  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  try {
    await sql.unsafe(`set role ${role}`);
    return await run(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** Rebuilds the schema and demo data. Returns the anchor the seed used. */
export async function resetDatabase(url: string, anchorAt: Date = new Date()) {
  return reset({ connectionString: url, allowDestructive: true, anchorAt });
}

/** Deletes the demo rows and rebuilds them, leaving the schema in place. */
export async function reseedDemoData(url: string, anchorAt: Date = new Date()) {
  return reseedDemo({ connectionString: url, allowDestructive: true, anchorAt });
}
