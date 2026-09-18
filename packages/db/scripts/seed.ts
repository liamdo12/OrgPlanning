import { seed } from "../src/seed/index.js";
import { reseedDemo } from "../src/demo.js";
import { allowDestructive, requireDatabaseUrl } from "./env.js";

/**
 * `--demo-only` deletes the demo rows and rebuilds them, which is what an admin
 * reseed does. Without it, this upserts reference and demo data in place.
 *
 * The wall clock is read here rather than in the library: `src/` takes the
 * anchor as an argument so that seeding under an admin clock override anchors
 * to the overridden time.
 */
const demoOnly = process.argv.includes("--demo-only");
const connectionString = requireDatabaseUrl();
const anchorAt = new Date();

const result = demoOnly
  ? await reseedDemo({ connectionString, allowDestructive: allowDestructive(), anchorAt })
  : await seed({ connectionString, anchorAt });

console.log(`seed: anchored at ${result.anchorAt.toISOString()}`);
for (const [table, count] of Object.entries(result.counts)) {
  console.log(`  ${table.padEnd(26)} ${count}`);
}
