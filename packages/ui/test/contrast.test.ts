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
