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
  /**
   * The platform acting on its own schedule.
   *
   * The job runner needs a principal: a balance charged automatically ahead of
   * an event was not requested by anybody, and attributing it to whichever
   * administrator happened to be signed in — or to a designated human account —
   * would put a name on the audit trail that did not do it.
   *
   * It is a skeleton key, and treated as one:
   *
   * - it is constructed in exactly one place, `SYSTEM` below, and never
   *   assembled from a request;
   * - `getActor` cannot produce it, and the three order policies are the only
   *   ones that admit it — both pinned in `test/jobs.test.ts`;
   * - `isAuthenticated` is false for it, so anything that needs a person — a
   *   checkout, an invite — still refuses it;
   * - `requireAdmin` refuses it too. It runs the platform's own timers; it is
   *   not an administrator and must not reach an administrative screen's
   *   actions.
   *
   * What it does pass are the object policies, because the thing it is acting
   * on behalf of is the platform itself rather than a party to the order.
   */
  | { kind: "system" }
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

/**
 * The platform's own principal. The only value of its kind.
 *
 * Reachable from the job runner and from nothing else: a route handler builds
 * its actor with `getActor`, which never returns this.
 */
export const SYSTEM: Actor = { kind: "system" };

export function isSystem(actor: Actor): actor is Extract<Actor, { kind: "system" }> {
  return actor.kind === "system";
}

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
