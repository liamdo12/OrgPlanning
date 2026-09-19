import { randomBytes } from "node:crypto";

/**
 * A label the run puts on everything it creates.
 *
 * The suite runs repeatedly against a persistent demo environment, so a name it
 * writes has to be unique across runs: "New vendor" from yesterday's run is a
 * row today's run will find, click, and make an assertion about. The id is in
 * every name and address the suite types, which also makes leftovers from a run
 * that died halfway obvious rather than mysterious.
 */
export const RUN_ID = process.env["E2E_RUN_ID"] ?? randomBytes(4).toString("hex");

/** A name nothing else on the platform will have. */
export function runScoped(label: string): string {
  return `${label} ${RUN_ID}`;
}

/** An address in a domain that goes nowhere, scoped the same way. */
export function runEmail(local: string): string {
  return `${local}+${RUN_ID}@e2e.invalid`;
}
