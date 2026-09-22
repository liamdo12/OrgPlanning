import { cx } from "@occasion/ui";

/**
 * The tinted block that stands in for a business's photography.
 *
 * Line 721: a two-stop gradient at 140°, 4/3, radius 18, with the category
 * named across the bottom (line 722). Line 759 draws the same thing at 16/10
 * for the detail hero.
 *
 * The pair is **data**, not a palette: `services.tone_start` / `tone_end` carry
 * the canvas's own colours, and `categories.tone` carries the whole gradient
 * for a tile. A table of hex values here would be a second copy that the first
 * vendor to pick their own colours makes wrong.
 *
 * It does not compose `Swatch`. That component sizes itself in pixels — width,
 * height and radius all derive from `size` (`swatch.tsx`) — and this block is
 * fluid with an aspect ratio, which no `className` can reach past an inline
 * style. The gradient is the same recipe; the box is the part that differs.
 *
 * The caption is `--color-body`, not the canvas's `rgba(31,42,36,0.55)`, which
 * measures 2.9:1 on the gradient it is drawn over.
 */
export function MediaPlaceholder({
  toneStart,
  toneEnd,
  caption,
  className,
}: {
  toneStart: string | null;
  toneEnd: string | null;
  /** e.g. "Flowers photo". Absent on a thumbnail, where there is no room. */
  caption?: string | undefined;
  className?: string;
}) {
  return (
    <span
      className={cx("relative block size-full", className)}
      style={{ background: gradientOf(toneStart, toneEnd) }}
    >
      {caption ? (
        <span className="absolute inset-x-0 bottom-0 px-[11px] py-[9px] text-[11px] font-semibold tracking-[0.08em] text-body uppercase">
          {caption}
        </span>
      ) : null}
    </span>
  );
}

/**
 * The canvas's 140° two-stop gradient, or a flat fallback.
 *
 * A listing whose tones were never set still needs a block — a transparent one
 * would show the page's own gradient through a card and read as a rendering
 * fault. The fallback is the paper the surface already sits on.
 */
export function gradientOf(toneStart: string | null, toneEnd: string | null): string {
  if (!toneStart || !toneEnd) return "#E4E0D3";
  return `linear-gradient(140deg, ${toneStart}, ${toneEnd})`;
}
