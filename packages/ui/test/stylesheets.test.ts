import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function read(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../src/styles/${name}`, import.meta.url)), "utf8");
}

const baseCss = read("base.css");
const componentsCss = read("components.css");

/**
 * The stylesheets have to stay inside a cascade layer.
 *
 * Unlayered CSS beats layered CSS whatever the specificity, and Tailwind emits
 * every utility into `@layer utilities`. So a single `.oc-*` rule written
 * outside a layer silently overrides every utility a caller passes as
 * `className` — a component's `rounded-card` stops working, and a selected
 * filter chip stops looking selected, with nothing failing anywhere.
 *
 * That is exactly what happened once. This is the guard.
 *
 * It asserts our half of the contract: every rule we ship is inside a layer,
 * and it is the layer we meant. It does not prove Tailwind's own output
 * ordering — that is Tailwind's contract, and `@layer theme, base, components,
 * utilities` is declared by `@import "tailwindcss"`.
 */

/** Strips comments, then walks braces to find rules at depth 0. */
function unlayeredRules(css: string): string[] {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const found: string[] = [];
  let depth = 0;
  let selector = "";

  for (const character of withoutComments) {
    if (character === "{") {
      if (depth === 0) {
        const name = selector.trim();
        // `@layer` and `@keyframes` are the only things allowed at the top.
        if (!name.startsWith("@layer") && !name.startsWith("@keyframes")) {
          found.push(name);
        }
      }
      depth += 1;
      selector = "";
    } else if (character === "}") {
      depth -= 1;
      selector = "";
    } else if (depth === 0) {
      selector += character;
    }
  }

  return found;
}

describe("design system stylesheets", () => {
  it("puts the page styles in the base layer", () => {
    const css = baseCss;
    expect(css).toContain("@layer base {");
    expect(unlayeredRules(css)).toEqual([]);
  });

  it("puts the component styles in the components layer", () => {
    const css = componentsCss;
    expect(css).toContain("@layer components {");
    expect(unlayeredRules(css)).toEqual([]);
  });

  it("never writes component styles into the utilities layer", () => {
    // Utilities are Tailwind's; a rule of ours in that layer would compete
    // with them by source order instead of losing to them predictably.
    for (const css of [baseCss, componentsCss]) {
      expect(css).not.toContain("@layer utilities");
    }
  });
});
