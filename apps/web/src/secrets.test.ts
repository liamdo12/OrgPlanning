import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Nothing that must stay on the server has a path to the browser.
 *
 * The service-role key bypasses every check the auth provider makes; the Stripe
 * secret key can move money; the webhook secrets are what make a forged event
 * distinguishable from a real one. None of them has any business in a bundle
 * the browser downloads, and the failure mode is silent — a build that leaks
 * one serves normally and looks correct.
 *
 * `import "server-only"` is the guard that actually stops it: pulled into a
 * client bundle, that import fails the build. This file asserts the guard is
 * where it needs to be, and that nothing has grown a way round it.
 */

const appRoot = fileURLToPath(new URL("..", import.meta.url));
const srcRoot = join(appRoot, "src");

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

const sources = walk(srcRoot).filter(
  (path) => /\.tsx?$/.test(path) && !path.endsWith(".test.ts") && !path.endsWith(".test.tsx"),
);

const label = (path: string) => relative(appRoot, path);
const read = (path: string) => readFileSync(path, "utf8");

/** Files that opt into the client bundle. */
const clientFiles = sources.filter((path) => /^["']use client["']/m.test(read(path)));

/**
 * Environment variables that must never reach a browser.
 *
 * Next inlines a variable into the client bundle only when its name begins with
 * `NEXT_PUBLIC_`, and none of these do — but the rule that keeps them safe is
 * the prefix, not intent, so a client component naming one is a mistake worth
 * catching even while it is harmless.
 */
const SERVER_ONLY_SECRETS = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "EMAIL_WEBHOOK_SECRET",
  "JOBS_TICK_SECRET",
  "RESEND_API_KEY",
  "DATABASE_URL",
] as const;

describe("the service-role client", () => {
  const adminClient = join(srcRoot, "lib/supabase/admin.ts");

  it("is reached through the validated environment, never the raw one", () => {
    // Not "only one module may name it": an admin action calls the provider's
    // user API directly, and that is a legitimate second caller. What must hold
    // is how it is obtained — `getEnv()`, which has already refused a boot with
    // the key missing, rather than `process.env`, which hands back `undefined`
    // and sends an unauthenticated request the provider answers with a 401
    // somebody then debugs as a permissions problem.
    const holders = sources.filter((path) => read(path).includes("SUPABASE_SERVICE_ROLE_KEY"));

    for (const path of holders) {
      if (path === join(srcRoot, "lib/env.ts")) continue;
      expect(
        /process\.env\[?["']?SUPABASE_SERVICE_ROLE_KEY/.test(read(path)),
        `${label(path)} reads the service-role key straight from the environment`,
      ).toBe(false);
    }

    // And the list is short enough to read. A new entry is a new place the key
    // travels, which is worth a moment's thought rather than a silent pass.
    expect(holders.map(label).sort()).toEqual([
      "src/app/(admin)/admin/users/actions.ts",
      "src/lib/env.ts",
      "src/lib/supabase/admin.ts",
    ]);
  });

  it("refuses to be bundled for the browser", () => {
    expect(read(adminClient).startsWith('import "server-only";')).toBe(true);
  });
});

describe("client components", () => {
  it("finds them", () => {
    // A walker that matched nothing would make every case below vacuous.
    expect(clientFiles.length).toBeGreaterThan(10);
  });

  it.each(SERVER_ONLY_SECRETS)("never name %s", (secret) => {
    const naming = clientFiles.filter((path) => read(path).includes(secret)).map(label);

    expect(naming).toEqual([]);
  });

  it("never import the service-role client", () => {
    const importers = clientFiles
      .filter((path) => /supabase\/admin|createSupabaseAdminClient/.test(read(path)))
      .map(label);

    expect(importers).toEqual([]);
  });

  it("never import the database or the domain's context factory", () => {
    // Either one drags a connection string into the module graph. The
    // `server-only` guard on `lib/core.ts` is what fails such a build; this
    // says so before the build does, and names the file.
    const importers = clientFiles
      .filter((path) => /from "@occasion\/db|createRequestContext|lib\/core/.test(read(path)))
      .map(label);

    expect(importers).toEqual([]);
  });
});

describe("environment access", () => {
  it("goes through the validated module, with the documented exceptions", () => {
    // The lint rule says the same thing and is the enforcement; this says which
    // files are exempt and why, which a rule configuration cannot.
    const readers = sources.filter((path) => /process\.env/.test(read(path))).map(label);

    expect(readers.sort()).toEqual([
      // Runs before anything else and fails the boot when the configuration is
      // contradictory — earlier than `getEnv()` is reachable.
      "src/instrumentation.ts",
      // Validates the raw environment. It is what everything else calls.
      "src/lib/env.ts",
      // Runs on the Edge runtime, where the validated module's Node imports
      // cannot follow. It reads the two public values only, and treats their
      // absence as "no session to refresh" rather than as a failure — the
      // decisions are made later, by `requireAdminActor()`.
      "src/proxy.ts",
    ]);
  });
});
