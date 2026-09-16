import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit is a developer tool, not application code: it runs from a shell
 * with a connection string, which is why this file is allowed to read the
 * environment while `src/` is not.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  schemaFilter: ["app"],
  casing: "snake_case",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
  },
  verbose: true,
  strict: true,
});
