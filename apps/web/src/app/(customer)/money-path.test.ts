import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * There is one money path, and the discovery screens stay on it.
 *
 * Two rules, and both of them are things that regress silently:
 *
 * **One formatter.** `formatMoney` exists in the domain, handles a malformed
 * currency code, and renders `C$` rather than the ambiguous `$`. A second one
 * written in a screen looks right in review and is wrong on the row nobody
 * pictured. So no screen here builds a currency string of its own.
 *
 * **No arithmetic.** Every figure on the booking card comes back from
 * `quoteCheckout`, which runs the checkout's own pricing. A multiplication or
 * a tax rate in a screen is a second implementation of the money rules, and
 * the day it disagrees somebody is quoted one deposit and billed another.
 *
 * Scoped to the discovery screens, which are the ones that exist. The other
 * customer screens should join this list as they land — a rule that walks a
 * directory somebody else is still writing fails for reasons that are not
 * about money.
 */

const group = fileURLToPath(new URL(".", import.meta.url));

/** The discovery screens and the components they draw with. */
const OWNED = ["page.tsx", "_components", "services", "saved"];

function walk(path: string): string[] {
  if (!existsSync(path)) return [];
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) =>
    walk(join(path, entry.name)),
  );
}

const sources = OWNED.flatMap((entry) => walk(join(group, entry))).filter(
  (path) => /\.tsx?$/.test(path) && !path.endsWith(".test.ts"),
);

/** Without the prose, so a rule quoted in a doc comment is not read as code. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

const files = sources.map((path) => ({ name: relative(group, path), text: code(path) }));

function offenders(pattern: RegExp): string[] {
  return files.filter((file) => pattern.test(file.text)).map((file) => file.name);
}

describe("the discovery screens", () => {
  it("finds the files it is checking", () => {
    // A walker pointed at the wrong directory passes every case below in
    // silence, which is what a green suite testing nothing looks like.
    expect(sources.length).toBeGreaterThanOrEqual(12);
  });

  it("has no second money formatter to import", () => {
    // Withdrawn before it was written, and it stays withdrawn.
    expect(existsSync(fileURLToPath(new URL("../../lib/money-format.ts", import.meta.url)))).toBe(
      false,
    );
  });

  it("builds no currency string of its own", () => {
    expect(offenders(/Intl\.NumberFormat/)).toEqual([]);
    expect(offenders(/["'`]C\$/)).toEqual([]);
    // The shape of cents divided into dollars by hand.
    expect(offenders(/toFixed\(2\)/)).toEqual([]);
  });

  it("multiplies no money", () => {
    // Wave two paid for this one: a `bigint` that arrived as a string threw at
    // runtime rather than at compile time, and the multiplication was the
    // place it surfaced. Quantities reach the domain; products come back.
    expect(offenders(/\*\s*BigInt\(/)).toEqual([]);
    expect(offenders(/\bsubtotal\s*[*+-]/)).toEqual([]);
    expect(offenders(/\btotal\s*[*+-]\s*\w/)).toEqual([]);
  });

  it("applies no rate", () => {
    expect(offenders(/\b0\.13\b/)).toEqual([]);
    expect(offenders(/\bhstBps\b/)).toEqual([]);
    expect(offenders(/\bcommissionBps\b/)).toEqual([]);
    // The deposit is a share of a total, and the only screen that says so says
    // it with a figure the quote handed over.
    expect(offenders(/\bdepositBps\s*\*/)).toEqual([]);
  });

  it("prices a booking through the read-only checkout and nothing else", () => {
    const detail = files.find((file) => file.name.endsWith("services/[slug]/page.tsx"));

    expect(detail?.text).toContain("quoteCheckout");
    // The pricing steps are deliberately off the barrel. Assembling them by
    // hand in a page would be a second implementation of `createCheckout`,
    // agreeing with itself and disagreeing with the charge.
    expect(offenders(/\beffectivePricing\b/)).toEqual([]);
    expect(offenders(/\bcomputeOrderMoney\b/)).toEqual([]);
    expect(offenders(/\bbuildPaymentPlan\b/)).toEqual([]);
    expect(offenders(/\bpriceServices\b|\bpricePackages\b/)).toEqual([]);
  });

  it("formats on the server, never in a client bundle", () => {
    // `packages/ui` may not import the domain and neither may a client
    // component here: money arrives at both as a string somebody already
    // formatted on the server.
    const clientsFormatting = files
      .filter((file) => /^\s*["']use client["']/m.test(file.text))
      .filter((file) => file.text.includes("formatMoney"))
      .map((file) => file.name);

    expect(clientsFormatting).toEqual([]);
  });

  it("imports the formatter wherever it formats", () => {
    const unimported = files
      .filter((file) => file.text.includes("formatMoney("))
      .filter((file) => !/import\s*\{[^}]*formatMoney/s.test(file.text))
      .map((file) => file.name);

    expect(unimported).toEqual([]);
  });
});
