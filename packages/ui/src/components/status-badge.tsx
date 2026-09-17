import type { ReactNode } from "react";
import { cx } from "../lib/cx";

/**
 * Status badges and the pills beside them.
 *
 * The four tones are pairs, and they are only ever used as pairs: each
 * background has exactly one foreground that is legible on it. Lines 2629–2634
 * for success, warning and neutral; line 2309 for danger.
 *
 * A caller passes a tone, never a colour. That is the point — the prototype
 * repeats the hex values on every row, and the first time someone types
 * `#E8F0EA` with `#3C4A43` on it the contrast is gone with nothing to catch it.
 */

export type StatusTone = "success" | "warn" | "danger" | "neutral";

export function StatusBadge({
  tone = "neutral",
  className,
  children,
}: {
  tone?: StatusTone;
  className?: string;
  children: ReactNode;
}) {
  return <span className={cx("oc-badge", `oc-badge--${tone}`, className)}>{children}</span>;
}

/**
 * A louder label: wider, letter-spaced, for a single call-out on a card.
 *
 * Line 630 in the prototype, where it marks a service as quote-only.
 */
export function Pill({
  tone = "neutral",
  className,
  children,
}: {
  tone?: StatusTone;
  className?: string;
  children: ReactNode;
}) {
  return <span className={cx("oc-pill", `oc-badge--${tone}`, className)}>{children}</span>;
}
