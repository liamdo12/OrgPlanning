import nextjs from "@occasion/config/eslint/nextjs";
import { restrictedImports } from "@occasion/config/eslint/base";

export default [
  ...nextjs,
  {
    // Operator scripts. They run under Node from a shell, so they see the
    // process and the console; nothing they do reaches the served app. Named
    // one by one because `globals` is not a dependency of this package.
    files: ["scripts/**/*.mjs"],
    languageOptions: { globals: { process: "readonly", console: "readonly" } },
    // These are CLI commands; their output to stdout is the point.
    rules: { "no-console": "off" },
  },
  {
    files: ["src/**/*.{ts,tsx}", "instrumentation.ts"],
    rules: restrictedImports([
      {
        group: ["@occasion/core/testing"],
        message:
          "createTestCoreContext ships fakes and permits the clock override. Build request contexts with createRequestContext() from src/lib/core.ts.",
      },
    ]).rules,
  },
];
