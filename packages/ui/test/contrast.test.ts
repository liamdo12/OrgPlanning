import { describe, expect, it } from "vitest";
import { AVATAR_TONES, initialsOf } from "../src/components/avatar.js";

/**
 * The contrast claims in the README, as assertions.
 *
 * A table in a README is a promise nobody re-checks. These are the two claims
 * that a future edit could quietly break: that every avatar tone carries white
 * initials at AA, and that the text colours clear AA over the worst backdrop
 * the ambient gradients produce — not over the paper base, which is the
 * *easiest* background for dark text, not the hardest.
 */

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => channel(Number.parseInt(h.slice(i, i + 2), 16))) as [
    number,
    number,
    number,
  ];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (high + 0.05) / (low + 0.05);
}

/** Paints `fg` at `alpha` over `bg`, the way a translucent surface composites. */
function over(fg: string, alpha: number, bg: string): string {
  const f = fg.replace("#", "");
  const b = bg.replace("#", "");
  let out = "#";
  for (const i of [0, 2, 4]) {
    const mixed =
      Number.parseInt(f.slice(i, i + 2), 16) * alpha +
      Number.parseInt(b.slice(i, i + 2), 16) * (1 - alpha);
    out += Math.round(mixed).toString(16).padStart(2, "0");
  }
  return out;
}

const PAPER = "#F2EFE7";
/** The strongest ambient gradient at its centre: line 200, over the paper. */
const WORST_BACKDROP = over("#3E6B34", 0.46, PAPER);
/** `--color-glass` and `--color-glass-wash` over that backdrop. */
const GLASS = over("#FFFFFF", 0.52, WORST_BACKDROP);
const WASH = over("#FFFFFF", 0.28, WORST_BACKDROP);

const AA = 4.5;
/** WCAG's floor for a graphic or a control boundary, where AA does not apply. */
const GRAPHICS = 3;

describe("contrast", () => {
  it("clears AA for body text on glass, over the strongest gradient", () => {
    expect(contrast("#3C4A43", GLASS)).toBeGreaterThanOrEqual(AA);
  });

  it("clears AA for a table heading on the header wash", () => {
    // The pair that failed at 3.2:1 when it used the prototype's lighter grey.
    expect(contrast("#3C4A43", WASH)).toBeGreaterThanOrEqual(AA);
  });

  it("clears AA for ink on glass", () => {
    expect(contrast("#1F2A24", GLASS)).toBeGreaterThanOrEqual(AA);
  });

  it("clears AA for white initials on every avatar tone", () => {
    for (const tone of AVATAR_TONES) {
      expect(contrast("#FFFFFF", tone), tone).toBeGreaterThanOrEqual(AA);
    }
  });

  it("clears AA for the role fills against the text they carry", () => {
    for (const role of ["#3E6B34", "#C2374B", "#1F4D3A"]) {
      expect(contrast("#F4F1E9", role), role).toBeGreaterThanOrEqual(AA);
    }
  });

  it("clears AA for muted text on the customer role fill", () => {
    // The prototype uses three greens for this and two of them fail: the hero
    // eyebrow at 4.13:1 (line 575) and the payment labels at 4.40:1 (lines
    // 924–927), neither of them large text. This is the third, and the other
    // two collapse into it.
    expect(contrast("#DCE8CE", "#3E6B34")).toBeGreaterThanOrEqual(AA);
  });

  it("clears AA for a disabled primary button's label", () => {
    // Asserted here, and the rule that puts these two colours on the button is
    // asserted in `stylesheets.test.ts`. Neither half means anything alone:
    // `.oc-button:disabled` fades every variant, and a pair written under that
    // fade composites back down to 2.61:1 — see the case below.
    expect(contrast("#3C4A43", "#DDE3DF")).toBeGreaterThanOrEqual(AA);
  });

  it("is why the disabled rule has to stop fading, not only recolour", () => {
    // What the button would measure if `.oc-button--primary:disabled` set the
    // colours and left `opacity: 0.55` in place. Worse than the graphics floor,
    // and barely different from the 2.32:1 the old rule produced — which is the
    // whole argument for the reset.
    const faded = (hex: string) => over(hex, 0.55, GLASS);
    expect(contrast(faded("#3C4A43"), faded("#DDE3DF"))).toBeLessThan(GRAPHICS);
    expect(contrast(faded("#F4F1E9"), faded("#3E6B34"))).toBeLessThan(GRAPHICS);
  });

  it("clears the graphics floor for the save heart, which is a glyph", () => {
    // Deliberately 3:1 and not AA. The heart is an icon with a text label
    // elsewhere, and the published 4.99:1 is a figure over an opaque card — on
    // the glass a card actually uses it is 3.71:1, so an AA assertion here
    // would have failed the day it was written and taken a correct colour with
    // it.
    expect(contrast("#C2374B", GLASS)).toBeGreaterThanOrEqual(GRAPHICS);
  });

  it("keeps a progress fill distinguishable from its track", () => {
    // Two adjacent graphics, so the floor is 3:1 and the pair is the role
    // colour against the unfilled remainder.
    expect(contrast("#3E6B34", "#EFE9DF")).toBeGreaterThanOrEqual(GRAPHICS);
  });
});

describe("initials", () => {
  it("takes the first and last name", () => {
    expect(initialsOf("Sarah Mensah")).toBe("SM");
    expect(initialsOf("Bea  Varga")).toBe("BV");
  });

  it("copes with one name, and with none", () => {
    expect(initialsOf("Prince")).toBe("P");
    expect(initialsOf("   ")).toBe("?");
  });
});
