import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { eventHub, getEvent, listEventsForOwner } from "@occasion/core";
import { parse } from "../../../authorization-registry.js";

/**
 * The planner asks the domain once, not once per slot.
 *
 * The failure this guards against is the one a list grows first and the one an
 * assertion on what comes back can never see: six slots that each look
 * something up are six round trips for a screen whose composing read already
 * has every answer. `eventHub` is that read — it takes the event once and
 * gathers the slots, the orders and the money together, so the four panels
 * cannot disagree with each other on screen either.
 *
 * Asserted against the **source**, because the claim is about call sites. How
 * many statements `eventHub` itself issues is its own business and is tested
 * where it lives.
 */

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The reads that would fan out if a component made them for itself.
 *
 * Taken from the functions themselves rather than written out, so a rename in
 * the domain either breaks this import or carries through — a hand-written
 * list would go on scanning for a name nothing has any more and reporting
 * success.
 */
const PLANNING_READS = [eventHub, getEvent, listEventsForOwner].map((read) => read.name);

function callsTo(path: string, name: string): number {
  let found = 0;

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === name
    ) {
      found += 1;
    }
    ts.forEachChild(node, visit);
  };

  ts.forEachChild(parse(path), visit);
  return found;
}

describe("the hub's query budget", () => {
  const pages = [
    join(here, "page.tsx"),
    join(here, "[eventId]", "page.tsx"),
    join(here, "[eventId]", "edit", "page.tsx"),
  ];

  it.each(pages.map((path) => [path.slice(here.length + 1), path] as const))(
    "%s composes the planner in one call",
    (_name, path) => {
      expect(callsTo(path, "eventHub")).toBe(1);
    },
  );

  it("does not let a component fetch for itself", () => {
    // A panel that loaded its own data would turn one read into one per panel,
    // and a slot that did would turn it into one per slot. Everything under
    // `_components` renders what the page handed it.
    const components = readdirSync(join(here, "_components"))
      .filter((name) => name.endsWith(".tsx") || name.endsWith(".ts"))
      .filter((name) => !name.endsWith(".test.ts"));

    expect(components.length).toBeGreaterThan(5);

    for (const name of components) {
      const source = readFileSync(join(here, "_components", name), "utf8");
      for (const read of PLANNING_READS) {
        expect(source, `${name} calls ${read}`).not.toContain(`${read}(`);
      }
    }
  });

  it("scans for names the domain still uses", () => {
    // If a read were renamed and this list did not follow, the scan above
    // would find nothing and report success.
    expect(PLANNING_READS).toEqual(["eventHub", "getEvent", "listEventsForOwner"]);
  });
});
