import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The integration suites under test/ rebuild the same database. In
    // parallel they would race on dropping the schema, which fails in ways
    // that look like schema bugs rather than a race.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
