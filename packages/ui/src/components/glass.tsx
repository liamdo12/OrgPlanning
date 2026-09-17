import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";
import { cx } from "../lib/cx";

/**
 * The glass surfaces.
 *
 * One recipe — line 227 in the prototype, and 62 further surfaces carrying the
 * same fill — behind three components that differ only in radius and
 * padding. Keeping it in `.oc-glass` rather than in each component is what lets
 * `prefers-reduced-transparency` replace it once (see `styles/base.css`).
 *
 * `as` exists because these are containers: a panel is often a `<section>` and
 * a row is often an `<li>`, and wrapping correct markup in a `<div>` to get a
 * background is how landmarks and lists get lost.
 */

type SurfaceProps = {
  as?: ElementType;
  className?: string;
  children: ReactNode;
  // Anything else the caller puts on the element — `aria-label` above all.
  // Without this it is silently dropped, and TypeScript will not say so:
  // hyphenated JSX attributes are exempt from excess-property checking.
} & Omit<ComponentPropsWithoutRef<"div">, "className" | "children">;

/** The largest surface: a page section. Radius 24px, line 592. */
export function GlassPanel({ as: Tag = "div", className, children, ...rest }: SurfaceProps) {
  return (
    <Tag className={cx("oc-glass rounded-panel", className)} {...rest}>
      {children}
    </Tag>
  );
}

/** A card inside a grid. Radius 22px with its own padding, line 1675. */
export function GlassCard({ as: Tag = "div", className, children, ...rest }: SurfaceProps) {
  return (
    <Tag className={cx("oc-glass rounded-row p-[15px]", className)} {...rest}>
      {children}
    </Tag>
  );
}

/**
 * Sticky chrome — a header or a toolbar that content scrolls under.
 *
 * Blurrier and lighter than a panel (line 217), because it sits over moving
 * content rather than over the background.
 */
export function GlassChrome({ as: Tag = "div", className, children, ...rest }: SurfaceProps) {
  return (
    <Tag className={cx("oc-chrome", className)} {...rest}>
      {children}
    </Tag>
  );
}
