import type { AuthPort } from "@occasion/core";
import { notImplemented } from "./not-implemented";

/**
 * Supabase Auth adapter.
 *
 * Kept behind this port so the provider stays swappable. Roles are not part of
 * it: they are re-read from the database on every request, because a token
 * claim cannot be revoked.
 */
export function createAuth(): AuthPort {
  return {
    getCurrentUser: () => notImplemented("Authentication"),
  };
}
