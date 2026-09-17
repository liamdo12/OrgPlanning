import type { RoleName } from "@occasion/core";
import type { Role } from "@occasion/ui";

/**
 * The bridge between the domain's roles and the design system's themes.
 *
 * They are separate types on purpose: `packages/ui` may not import the domain,
 * so it declares its own three names. They do have to agree, and this is the
 * one place where that is checked — `themeFor` stops compiling if the domain
 * gains a role the design system has no theme for, and the assertion below
 * stops compiling in the other direction.
 *
 * This app is the only package that imports both, so it is the only place the
 * check can live.
 */
export function themeFor(role: RoleName): Role {
  return role;
}

/**
 * The other direction. The conditional resolves to `never` if the design
 * system ever names a theme the domain does not have, and `true` cannot be
 * assigned to `never` — so the assignment below is what actually fails, not
 * the type on its own.
 */
type EveryThemeIsARole = Role extends RoleName ? true : never;

export const ROLES_AGREE: EveryThemeIsARole = true;
