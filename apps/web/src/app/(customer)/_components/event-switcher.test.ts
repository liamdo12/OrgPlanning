import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { parse } from "../../../authorization-registry.js";

/**
 * The switcher's buttons must survive their own click.
 *
 * This file exists because of a defect that produced **no error anywhere**: a
 * `setOpen(false)` in each submit button's `onClick` unmounted the surrounding
 * form while the click was still being handled, so the browser never dispatched
 * `submit` and the server action was never called. The cookie was not written,
 * the chip went on naming the previous event, and nothing logged, threw or
 * failed. It was invisible for two waves because the shell had only ever been
 * handed one event, and with one there is nothing to switch to — the planner is
 * the first screen that lists several.
 *
 * Asserted against the **source**, in the shape the authorization registries
 * already use, because this package has no DOM to render into and adding one
 * for a single component would be a dependency the repository does not
 * otherwise need. The assertion still catches the exact class: a submit button
 * whose own handler can take its form away.
 *
 * Scoped to this file rather than swept across the customer surface. A click
 * handler on a submit button is not wrong everywhere — it is wrong on a
 * control whose handler unmounts the form — and a broad sweep would fail
 * somebody else's file for a shape that is fine in it.
 */

const here = dirname(fileURLToPath(import.meta.url));
const source = parse(join(here, "event-switcher.tsx"));

/** Every JSX `<button>` in the file, with the attribute names it carries. */
function buttons(): Array<{ attributes: string[] }> {
  const found: Array<{ attributes: string[] }> = [];

  const visit = (node: ts.Node): void => {
    const opening = ts.isJsxSelfClosingElement(node)
      ? node
      : ts.isJsxElement(node)
        ? node.openingElement
        : undefined;

    if (opening && opening.tagName.getText() === "button") {
      found.push({
        attributes: opening.attributes.properties
          .filter(ts.isJsxAttribute)
          .map((attribute) => attribute.name.getText()),
      });
    }

    ts.forEachChild(node, visit);
  };

  ts.forEachChild(source, visit);
  return found;
}

describe("the shell's event switcher", () => {
  it("has a trigger and a submit button to find", () => {
    // A walk that matched nothing would make every case below vacuous, which is
    // exactly what a passing suite would look like.
    const all = buttons();
    expect(all.length).toBeGreaterThanOrEqual(2);
    expect(all.some((button) => button.attributes.includes("type"))).toBe(true);
  });

  it("puts no click handler on a button that submits", () => {
    const submits = buttons().filter((button) => button.attributes.includes("name"));

    expect(submits.length).toBeGreaterThan(0);
    for (const button of submits) {
      expect(button.attributes, "a submit button must not close its own form").not.toContain(
        "onClick",
      );
    }
  });

  it("carries the selection in the form rather than in a handler", () => {
    // `name`/`value` on the submit button is what puts the chosen event in the
    // request. A version that kept the id in state and posted it from a click
    // would be the same bug wearing a different hat.
    const text = source.getFullText();
    expect(text).toContain('name="eventId"');
    expect(text).toContain("selectActiveEventAction");
  });
});
