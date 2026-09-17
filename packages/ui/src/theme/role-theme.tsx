import type { ReactNode } from "react";
import type { Role } from "./roles";

/**
 * Applies a role theme to everything inside it.
 *
 * The whole mechanism is `data-role`, which rewrites three custom properties
 * (see the theme block in `styles/base.css`). No context, no provider state and
 * no re-render when it changes; nesting one inside another works, so an
 * administrator previewing a customer surface gets the customer palette in that
 * subtree and nowhere else.
 */
export function RoleTheme({
  role,
  children,
  className,
}: {
  role: Role;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div data-role={role} className={className}>
      {children}
    </div>
  );
}
