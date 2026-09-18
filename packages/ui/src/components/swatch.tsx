import { cx } from "../lib/cx";

/**
 * The tinted square that stands in for a business's photography.
 *
 * Line 1646: 34px, radius 13, a flat tone and nothing inside it. The prototype
 * assigns each vendor a colour by hand; six of them appear across the admin
 * queue (lines 2715–2720) and they are the palette here.
 *
 * Purely decorative and `aria-hidden` — the name is always beside it, and a
 * coloured square read aloud is noise. That is also why these tones need no
 * contrast check: nothing is ever drawn on them.
 */

/** Source: the `tone` values on `adminVendors`, lines 2715–2720. */
export const SWATCH_TONES = [
  "#D6BFA8",
  "#D3B0A2",
  "#B4C6BA",
  "#C9C2B1",
  "#B6BAC8",
  "#D0B4BA",
] as const;

/**
 * Derived from the name rather than stored, so a business is the same colour on
 * every screen without anyone having to keep a column in step.
 */
function toneFor(seed: string): string {
  let hash = 0;
  for (const character of seed) {
    hash = (hash * 31 + character.codePointAt(0)!) % 100_000;
  }
  return SWATCH_TONES[hash % SWATCH_TONES.length] as string;
}

export function Swatch({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cx("block size-[34px] flex-none rounded-[13px]", className)}
      style={{ background: toneFor(name) }}
    />
  );
}
