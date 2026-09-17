import "server-only";

import { cookies } from "next/headers";
import { parseRoleName, type RoleName } from "@occasion/core";
import { getEnv } from "./env";

/**
 * The role a person is currently looking through.
 *
 * Kept in a cookie because it is a preference, not a permission. `getActor`
 * honours it only when the role is actually held, and every gate reads
 * `actor.roles` — so the worst a forged value can do is change which menu the
 * forger sees.
 *
 * It is still `httpOnly`: the value ends up on every audit row as the acting
 * role, and an audit trail that a page script can rewrite is not one worth
 * keeping.
 */

const COOKIE = "occasion.active-role";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/** The requested role for this request, if the cookie carries a known one. */
export async function readActiveRole(): Promise<RoleName | undefined> {
  const store = await cookies();
  return parseRoleName(store.get(COOKIE)?.value);
}

/**
 * Remembers the chosen role.
 *
 * Callable only from a server action or route handler — a server component
 * cannot set cookies.
 */
export async function writeActiveRole(role: RoleName): Promise<void> {
  const store = await cookies();

  store.set(COOKIE, role, {
    httpOnly: true,
    sameSite: "lax",
    // Plain HTTP only in local development, where there is no TLS to require.
    secure: getEnv().APP_TIER !== "local",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

/** Forgets the chosen role, so the next request falls back to the default. */
export async function clearActiveRole(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE);
}
