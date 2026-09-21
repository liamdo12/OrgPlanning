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

/**
 * The declarations of one rule, by its exact selector.
 *
 * Whitespace-insensitive on the selector and returned verbatim, so a case can
 * say which declaration is missing rather than "the file does not contain this
 * string" — which is what a `toContain` on the whole stylesheet says, and it
 * says it identically whether the rule is absent or merely different.
 */
function declarationsOf(css: string, selector: string): string | undefined {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[},])\\s*${escaped}\\s*\\{([^}]*)\\}`, "m").exec(withoutComments)?.[2];
}

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

  /**
   * The disabled primary button, read off the stylesheet rather than computed.
   *
   * `contrast.test.ts` can only say that two hexes clear AA. It never opens
   * this file, so it would go on passing over a pair the rendered button does
   * not use — and it would be a pair the button does not use, because
   * `.oc-button:disabled` sets `opacity: 0.55` on every variant and composites
   * any colour written under it back down. The pair at 0.55 is 2.61:1, which is
   * no better than the 2.32:1 it replaced.
   *
   * So the ratio is asserted there and the rule is asserted here, and it takes
   * both to mean anything.
   */
  it("gives a disabled primary button its own colours and stops fading it", () => {
    const rule = declarationsOf(componentsCss, ".oc-button--primary:disabled");

    expect(rule, "no rule for a disabled primary button").toBeDefined();
    expect(rule).toMatch(/background:\s*var\(--color-disabled-bg\)/);
    expect(rule).toMatch(/color:\s*var\(--color-disabled-fg\)/);
    expect(rule).toMatch(/opacity:\s*1\s*;/);
  });

  it("still fades every other disabled button, which is what the reset is for", () => {
    // If this ever stops being true the reset above is dead weight rather than
    // load-bearing, and whoever removes it should have to notice.
    const base = declarationsOf(componentsCss, ".oc-button:disabled");

    expect(base).toBeDefined();
    expect(base).toMatch(/opacity:\s*0?\.\d+/);
  });

  it("never writes component styles into the utilities layer", () => {
    // Utilities are Tailwind's; a rule of ours in that layer would compete
    // with them by source order instead of losing to them predictably.
    for (const css of [baseCss, componentsCss]) {
      expect(css).not.toContain("@layer utilities");
    }
  });
});
