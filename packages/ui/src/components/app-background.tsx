import type { ReactNode } from "react";
import { cx } from "../lib/cx";
import type { Role } from "../theme/roles";

/**
 * The page: ambient gradients behind, content in front.
 *
 * Four fixed radial gradients over the paper base, lines 197–204. The
 * prototype paints them with `body::before`; here they are an element, so a
 * route can leave them out and so the thing doing the painting is visible in
 * the tree rather than hidden in a global stylesheet.
 *
 * `pointer-events: none` and `z-index: 0` keep it inert and behind everything
 * (line 198). Under `prefers-reduced-transparency` it is not rendered at all.
 */
export function AppBackground({
  role = "customer",
  className,
  children,
}: {
  role?: Role;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div data-role={role}>
      <div className="oc-ambient" aria-hidden="true" />
      <div className={cx("oc-app", className)}>{children}</div>
    </div>
  );
}
