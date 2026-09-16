import nextjs from "@occasion/config/eslint/nextjs";
import { restrictedImports } from "@occasion/config/eslint/base";

export default [
  ...nextjs,
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
