import postgres from "postgres";
import { migrate } from "./migrate.js";
import { seed, type SeedResult } from "./seed/index.js";

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
