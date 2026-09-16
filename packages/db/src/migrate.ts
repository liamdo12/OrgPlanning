import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

/**
 * Applies every `.sql` file in `migrations/` in filename order, once.
 *
 * Deliberately not Drizzle's own migrator: some of what this schema needs —
 * roles, row-level security, an exclusion constraint — cannot be expressed in
 * the schema DSL, so those migrations are hand-written SQL that the generator
 * knows nothing about. One runner over plain files keeps generated and
 * hand-written migrations in a single ordered history.
 *
 * Pure: the connection string is an argument. The CLI wrapper in `scripts/`
 * is the only place that reads it from the environment.
 */

const migrationsDir = fileURLToPath(new URL("../migrations", import.meta.url));

export async function migrate(connectionString: string): Promise<string[]> {
  const sql = postgres(connectionString, { max: 1, prepare: false, onnotice: () => {} });
  const applied: string[] = [];

  try {
    await sql.unsafe(`
      create schema if not exists app;
      create table if not exists app.__migrations (
        filename text primary key,
        applied_at timestamptz not null default now()
      );
    `);

    const done = new Set(
      (await sql<{ filename: string }[]>`select filename from app.__migrations`).map(
        (row) => row.filename,
      ),
    );

    const files = readdirSync(migrationsDir)
      .filter((name) => name.endsWith(".sql"))
      .sort();

    for (const file of files) {
      if (done.has(file)) continue;

      const body = readFileSync(join(migrationsDir, file), "utf8");

      // One transaction per file: a migration that fails halfway leaves no
      // partial schema behind, and is retried whole on the next run.
      await sql.begin(async (tx) => {
        // Drizzle's generator separates statements with this marker; running
        // the file as one simple query would otherwise stop at the first one.
        for (const statement of body.split("--> statement-breakpoint")) {
          if (statement.trim().length === 0) continue;
          await tx.unsafe(statement);
        }
        await tx`insert into app.__migrations (filename) values (${file})`;
      });

      applied.push(file);
    }

    return applied;
  } finally {
    await sql.end({ timeout: 5 });
  }
}
