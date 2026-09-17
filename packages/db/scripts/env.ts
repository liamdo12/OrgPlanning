/**
 * The only place in this package that reads the environment.
 *
 * `src/` is a library: it takes a connection string as an argument so a domain
 * test can run against a throwaway database with nothing exported. These CLI
 * wrappers are the boundary where a shell's variables become that argument.
 */
export function requireDatabaseUrl(): string {
  const url = process.env["DATABASE_URL"];
  if (!url) {
    // Deliberately not read from `apps/web/.env.local`. That file carries the
    // connection the *application* uses — `app_rw`, least privilege, no DDL —
    // and migrating with it fails on a permission error several steps later.
    // Schema work wants the superuser, so the two are supplied separately and
    // this says which one it wants.
    console.error(
      [
        "DATABASE_URL is required, and schema commands want a superuser:",
        "",
        "  DATABASE_URL=postgresql://supabase_admin:postgres@127.0.0.1:54322/postgres \\",
        "    pnpm --filter @occasion/db db:reset",
        "",
        "The application's own connection string is `app_rw` and cannot do this.",
        "See the quickstart in README.md.",
      ].join("\n"),
    );
    process.exit(1);
  }
  return url;
}

/**
 * Destructive commands are refused on the production tier.
 *
 * Reading APP_TIER rather than NODE_ENV is deliberate: the demo deployment is a
 * production build that must still be able to reseed itself.
 */
export function allowDestructive(): boolean {
  return (process.env["APP_TIER"] ?? "local") !== "production";
}
