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
    console.error("DATABASE_URL is required. See .env.example at the repo root.");
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
