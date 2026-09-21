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

/**
 * The tinted block, at whatever size and in whatever colour the caller has.
 *
 * `tone` and `size` are props rather than something a caller composes through
 * `className`, because neither is composable here: the colour is an inline
 * style, which no utility class can override, and `cx` is a plain join with no
 * `tailwind-merge` behind it, so a second `size-*` class loses or wins by
 * source order. Both default to what the admin queue already renders, so the
 * one existing caller passes neither and is unchanged.
 *
 * A `tone` pair is a two-stop gradient at the prototype's own 140°, which is
 * how every media block in the customer surface is drawn (lines 1950–1961 for
 * the services, 1967–1973 for the categories).
 */
export function Swatch({
  name,
  tone,
  size = 34,
  className,
}: {
  name: string;
  /** A colour, or a light/dark pair drawn as a gradient. Defaults to the hash. */
  tone?: string | readonly [string, string];
  /** Edge length in pixels. The radius follows it, as the prototype's does. */
  size?: number;
  className?: string;
}) {
  const fill =
    tone === undefined
      ? toneFor(name)
      : typeof tone === "string"
        ? tone
        : `linear-gradient(140deg, ${tone[0]}, ${tone[1]})`;

  return (
    <span
      aria-hidden="true"
      className={cx("block flex-none", className)}
      style={{
        background: fill,
        width: `${size}px`,
        height: `${size}px`,
        // 13 on 34 in the prototype (line 1646); kept as a ratio so a larger
        // block does not end up with a hairline corner.
        borderRadius: `${Math.round((size * 13) / 34)}px`,
      }}
    />
  );
}
