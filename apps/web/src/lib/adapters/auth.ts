import type { AuthPort, AuthUser } from "@occasion/core";
import { createSupabaseServerClient } from "../supabase/server";

/**
 * Supabase Auth adapter.
 *
 * Identity only. Roles and account status are re-read from the database by the
 * identity service on every request, because a claim in a token cannot be
 * taken back before that token expires.
 *
 * Uses `getClaims()` rather than `getSession()`: a session read straight from
 * a cookie is client-controlled, so trusting it server-side means trusting the
 * browser. `getClaims()` verifies the token's signature first.
 */
export function createAuth(): AuthPort {
  return {
    async getCurrentUser(): Promise<AuthUser | null> {
      const supabase = await createSupabaseServerClient();
      const { data, error } = await supabase.auth.getClaims();

      if (error || !data?.claims) return null;

      const claims = data.claims as {
        sub?: string;
        email?: string;
        iat?: number;
        email_verified?: boolean;
        user_metadata?: { email_verified?: boolean };
      };
      if (!claims.sub) return null;

      return {
        id: claims.sub,
        email: claims.email ?? "",
        // `iat` is seconds since the epoch. The identity service compares it
        // against the account's revocation cutoff, which is what makes a
        // suspension or a role change take effect on the next request rather
        // than whenever the token would have expired.
        issuedAt: typeof claims.iat === "number" ? new Date(claims.iat * 1000) : null,
        // Load-bearing: a first sign-in binds this provider subject to an
        // existing row by matching the address, so an unproven address would
        // let anyone claim a seeded account by registering with its email.
        emailVerified:
          claims.email_verified === true || claims.user_metadata?.email_verified === true,
      };
    },
  };
}
