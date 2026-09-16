import { migrate } from "../src/migrate.js";
import { requireDatabaseUrl } from "./env.js";

const applied = await migrate(requireDatabaseUrl());

console.log(
  applied.length === 0
    ? "migrate: already up to date"
    : `migrate: applied ${applied.length} migration(s)\n  ${applied.join("\n  ")}`,
);
