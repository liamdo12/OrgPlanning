import { reset } from "../src/reset.js";
import { allowDestructive, requireDatabaseUrl } from "./env.js";

const started = Date.now();
const result = await reset({
  connectionString: requireDatabaseUrl(),
  allowDestructive: allowDestructive(),
  // The wall clock is read at the CLI boundary, never in the library.
  anchorAt: new Date(),
});

console.log(`reset: anchored at ${result.anchorAt.toISOString()}`);
for (const [table, count] of Object.entries(result.counts)) {
  console.log(`  ${table.padEnd(26)} ${count}`);
}
console.log(`reset: completed in ${((Date.now() - started) / 1000).toFixed(1)}s`);
