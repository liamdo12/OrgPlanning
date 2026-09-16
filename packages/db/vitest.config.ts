import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Every suite here rebuilds the same database. Running the files in
    // parallel means two of them dropping and recreating the schema at once,
    // which fails in ways that look like schema bugs rather than a race.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
