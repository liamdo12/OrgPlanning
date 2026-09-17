/**
 * Who is making a request.
 *
 * An `Actor` is assembled per request from the database, never from a token
 * claim: a role encoded in a token cannot be taken away before that token
 * expires, so the claim is treated as a cache and the row is the authority.
 */

import { ForbiddenError } from "../errors.js";

export type RoleName = "customer" | "vendor" | "admin";

/** Every role this system knows. Order is the fallback order for `activeRole`. */
export const ROLE_NAMES: readonly RoleName[] = ["admin", "vendor", "customer"];

export type UserStatus = "active" | "pending" | "unverified" | "suspended";

export type Actor =
  | { kind: "anonymous" }
  | {
      kind: "user";
      userId: string;
      email: string;
      status: UserStatus;
      /** Every role held, re-read from `user_roles` this request. */
      roles: readonly RoleName[];
      /**
       * The role the person is currently looking through, used for audit
       * provenance and UI. Authority is never derived from it — an admin
       * browsing as a customer is still an admin, and a customer cannot
       * become one by selecting a different chip.
       */
      activeRole: RoleName;
      /** Vendor organisations this person belongs to. */
      vendorIds: readonly string[];
    };

export const ANONYMOUS: Actor = { kind: "anonymous" };

/** Roles a person may choose for themselves at signup. `admin` is not one. */
export const SELF_ASSIGNABLE_ROLES: readonly RoleName[] = ["customer", "vendor"];

export function isAuthenticated(actor: Actor): actor is Extract<Actor, { kind: "user" }> {
  return actor.kind === "user";
}

export function hasRole(actor: Actor, role: RoleName): boolean {
  return isAuthenticated(actor) && actor.roles.includes(role);
}

export function isAdmin(actor: Actor): boolean {
  return hasRole(actor, "admin");
}

/**
 * Whether the account may act at all.
 *
 * `pending` and `unverified` accounts exist and can sign in far enough to be
 * told why they cannot proceed; `suspended` ones cannot act. Only `active`
 * passes.
 */
export function isUsable(actor: Actor): actor is Extract<Actor, { kind: "user" }> {
  return isAuthenticated(actor) && actor.status === "active";
}

export function belongsToVendor(actor: Actor, vendorId: string): boolean {
  return isAuthenticated(actor) && actor.vendorIds.includes(vendorId);
}

/** Narrows an arbitrary value — a cookie, a form field — to a known role. */
export function parseRoleName(value: unknown): RoleName | undefined {
  return ROLE_NAMES.find((role) => role === value);
}

/**
 * Resolves the role a person asked to look through.
 *
 * Switching roles changes what is shown and what an audit row records; it never
 * changes what is permitted. Refusing a role the actor does not hold is
 * therefore not an authorization check — `requireAdmin` still runs regardless —
 * it stops the audit trail from being able to name a role the person never had.
 */
export function selectActiveRole(actor: Actor, requested: unknown): RoleName {
  const role = parseRoleName(requested);

  if (!role || !hasRole(actor, role)) {
    throw new ForbiddenError("Not one of your roles.");
  }

  return role;
}
