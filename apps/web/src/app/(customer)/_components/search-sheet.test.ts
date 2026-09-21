import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The search panel is a new overlay and not a new focus trap.
 *
 * Those are two different things and only the first one is justified: the
 * shipped scrim is `z-index: 60` and covers the viewport, while the prototype
 * puts the search scrim at **30**, below the header at 40, because the header
 * stays visible and interactive above it. So the surface had to be built.
 *
 * The trap did not. `useDismissable` already pays for two bugs that were found
 * once — the close callback held in a ref, so a controlled field does not lose
 * its caret, and hidden inputs excluded from the focusable query — and a second
 * implementation re-opens both somewhere nobody is looking. This reads the
 * source rather than trusting it, because the way a second trap arrives is
 * somebody writing a keydown handler for one screen.
 */

const groupRoot = fileURLToPath(new URL("..", import.meta.url));
const sheet = join(groupRoot, "_components/search-sheet.tsx");

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

const sources = walk(groupRoot).filter(
  (path) => /\.tsx?$/.test(path) && !path.endsWith(".test.ts"),
);

/** Without the prose, so a rule quoted in a doc comment is not read as code. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("the search panel", () => {
  const source = code(sheet);

  it("uses the design system's trap", () => {
    expect(source).toContain("useDismissable");
    expect(source).toMatch(/import \{[^}]*useDismissable[^}]*\} from "@occasion\/ui"/s);
  });

  it("puts its scrim under the header rather than over it", () => {
    // The whole reason this overlay exists instead of `Sheet`. At the shipped
    // scrim's 60 the header would be unreachable, and the control being edited
    // is in the header.
    expect(source).toContain("z-30");
    expect(source).not.toContain("oc-scrim");
  });

  it("closes on a click outside through a control, not a bare div", () => {
    // A div with a click handler is unreachable from a keyboard, which would
    // leave Escape as the only way out — and Escape is the thing most likely to
    // be missed when somebody reimplements this.
    expect(source).toMatch(/<button[\s\S]{0,400}onMouseDown=\{onClose\}/);
  });
});

describe("the customer surface", () => {
  it("has no second focus trap", () => {
    // Anything cycling Tab by hand is one. `useDismissable` is the only place
    // that may, and it is not in this tree.
    const offenders = sources
      .filter((path) => {
        const text = code(path);
        return text.includes('"Tab"') || text.includes("'Tab'");
      })
      .map((path) => relative(groupRoot, path));

    expect(offenders).toEqual([]);
  });

  it("finds the files it is checking", () => {
    // A walker pointed at the wrong directory passes the case above silently.
    expect(sources.length).toBeGreaterThanOrEqual(8);
  });
});
