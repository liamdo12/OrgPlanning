import nodeLibrary from "@occasion/config/eslint/node-library";
import {
  noGlobalConfigAccess,
  restrictedImports,
  DB_FORBIDDEN_IMPORTS,
  SOURCE_GLOB,
} from "@occasion/config/eslint/base";

export default [
  ...nodeLibrary,
  {
    files: SOURCE_GLOB,
    rules: {
      // The connection string arrives as an argument, never from the environment.
      ...noGlobalConfigAccess.rules,
      ...restrictedImports(DB_FORBIDDEN_IMPORTS).rules,
    },
  },
  {
    // `scripts/` is the CLI boundary and `test/` needs TEST_DATABASE_URL;
    // both legitimately read the environment so that `src/` never has to.
    // drizzle-kit's config is a developer tool, not application code.
    files: ["scripts/**/*.ts", "test/**/*.ts", "drizzle.config.ts"],
    rules: {
      "no-process-env": "off",
      // These are CLI commands; their output to stdout is the point.
      "no-console": "off",
    },
  },
];
