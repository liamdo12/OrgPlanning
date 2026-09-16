import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { afterAll, describe, expect, it } from "vitest";

/**
 * The domain boundaries are asserted here rather than left to a checklist,
 * because a boundary nobody tests is a boundary that quietly stops holding:
 *
 *   - a deliberate `import "next/headers"` must fail
 *   - a deliberate `process.env.X` must fail
 *
 * The rules come from this package's own flat config, so unwiring the config
 * fails this suite just as deleting a rule does.
 *
 * Fixtures are real files under `src/` because type-aware linting resolves
 * through the TypeScript project service, which rejects a path that is not on
 * disk. The package's ESLint and tsconfig both ignore `boundary-fixture-*`, so
 * a fixture left behind by an interrupted run cannot break the next `pnpm lint`
 * or `pnpm typecheck`; this suite passes `ignore: false` to lint them anyway.
 */

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const fixtureDir = mkdtempSync(join(packageRoot, "src", "boundary-fixture-"));

afterAll(() => {
  rmSync(fixtureDir, { recursive: true, force: true });
});

let counter = 0;

async function lint(code: string): Promise<string[]> {
  const filePath = join(fixtureDir, `case-${++counter}.ts`);
  writeFileSync(filePath, code, "utf8");

  const eslint = new ESLint({
    cwd: packageRoot,
    // The package config ignores fixtures so a leftover cannot fail `pnpm lint`;
    // this suite is the one caller that wants them linted.
    ignore: false,
    overrideConfig: {
      languageOptions: {
        parserOptions: {
          // They are excluded from tsconfig for the same reason, so the project
          // service needs explicit permission to parse them.
          projectService: { allowDefaultProject: ["src/boundary-fixture-*/*.ts"] },
        },
      },
    },
  });
  const [result] = await eslint.lintText(code, { filePath });

  return (result?.messages ?? []).map((message) => message.ruleId ?? `(fatal: ${message.message})`);
}

describe("packages/core boundaries", () => {
  it("rejects importing the framework", async () => {
    const rules = await lint(
      `import { headers } from "next/headers";\nexport const h = headers;\n`,
    );

    expect(rules).toContain("no-restricted-imports");
  });

  it("rejects importing React", async () => {
    const rules = await lint(`import { useState } from "react";\nexport const u = useState;\n`);

    expect(rules).toContain("no-restricted-imports");
  });

  it("rejects importing the design system", async () => {
    const rules = await lint(`import * as ui from "@occasion/ui";\nexport const u = ui;\n`);

    expect(rules).toContain("no-restricted-imports");
  });

  it("rejects reading process.env", async () => {
    const rules = await lint(`export const tier = process.env["APP_TIER"];\n`);

    expect(rules).toContain("no-process-env");
  });

  it("rejects importing the process module, which would shadow the global", async () => {
    const rules = await lint(
      `import { env } from "node:process";\nexport const tier = env["APP_TIER"];\n`,
    );

    expect(rules).toContain("no-restricted-imports");
  });

  it("accepts a module that takes its config as an argument", async () => {
    const rules = await lint(
      `export function commission(subtotalCents: bigint, bps: number): bigint {\n` +
        `  return (subtotalCents * BigInt(bps)) / 10000n;\n` +
        `}\n`,
    );

    expect(rules).toEqual([]);
  });
});
