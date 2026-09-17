import { and, eq, sql } from "drizzle-orm";
import { authAttempts } from "@occasion/db/schema";
import type { CoreContext } from "../context.js";
import { RateLimitedError } from "../errors.js";

/**
 * A fixed-window counter for the endpoints worth guessing at.
 *
 * Kept in the database rather than in memory because the app runs as more than
 * one process: a per-process limiter silently multiplies the real limit by the
 * number of instances. A shared cache replaces this when there is one, behind
 * the same two functions.
 */

export type RateLimitRule = {
  /** What is being limited, e.g. `login`. */
  scope: string;
  /** Attempts permitted inside one window. */
  limit: number;
  windowMs: number;
  /** How long a subject is refused after exceeding the limit. */
  blockMs: number;
};

export const LOGIN_RULE: RateLimitRule = {
  scope: "login",
  limit: 10,
  windowMs: 15 * 60 * 1000,
  blockMs: 15 * 60 * 1000,
};

/**
 * Second-factor codes.
 *
 * A six-digit code is 10^6 possibilities and each one is valid for about a
 * minute, so an unbounded endpoint is guessable in an afternoon. Tighter than
 * the login limit because nobody mistypes it ten times.
 */
export const SECOND_FACTOR_RULE: RateLimitRule = {
  scope: "second_factor",
  limit: 6,
  windowMs: 15 * 60 * 1000,
  blockMs: 15 * 60 * 1000,
};

export const PASSWORD_RESET_RULE: RateLimitRule = {
  scope: "password_reset",
  limit: 5,
  windowMs: 60 * 60 * 1000,
  blockMs: 60 * 60 * 1000,
};

function windowStart(now: Date, windowMs: number): Date {
  return new Date(Math.floor(now.getTime() / windowMs) * windowMs);
}

/**
 * Counts an attempt and throws once the subject is over the limit.
 *
 * The increment happens whether or not the attempt succeeds. Counting only
 * failures lets an attacker reset their own budget with one correct guess
 * among many.
 *
 * `subject` should be normalised by the caller — an email lowercased, an
 * address canonicalised — so that trivial variations do not each get a fresh
 * allowance.
 */
export async function consumeAttempt(
  ctx: CoreContext,
  rule: RateLimitRule,
  subject: string,
): Promise<void> {
  const now = ctx.clock.realNow();
  const start = windowStart(now, rule.windowMs);

  const [row] = await ctx.db
    .insert(authAttempts)
    .values({
      scope: rule.scope,
      subject,
      windowStartedAt: start,
      attempts: 1,
    })
    .onConflictDoUpdate({
      target: [authAttempts.scope, authAttempts.subject, authAttempts.windowStartedAt],
      set: {
        attempts: sql`${authAttempts.attempts} + 1`,
        updatedAt: now,
      },
    })
    .returning({ attempts: authAttempts.attempts, blockedUntil: authAttempts.blockedUntil });

  const attempts = row?.attempts ?? 1;
  const blockedUntil = row?.blockedUntil ?? null;

  if (blockedUntil && blockedUntil > now) {
    throw new RateLimitedError(undefined, blockedUntil);
  }

  if (attempts > rule.limit) {
    const until = new Date(now.getTime() + rule.blockMs);

    await ctx.db
      .update(authAttempts)
      .set({ blockedUntil: until, updatedAt: now })
      .where(
        and(
          eq(authAttempts.scope, rule.scope),
          eq(authAttempts.subject, subject),
          eq(authAttempts.windowStartedAt, start),
        ),
      );

    throw new RateLimitedError(undefined, until);
  }
}

/**
 * Clears a subject's counter.
 *
 * Called after a successful sign-in so that a person who mistyped their
 * password several times is not still carrying that history an hour later.
 */
export async function clearAttempts(
  ctx: CoreContext,
  rule: RateLimitRule,
  subject: string,
): Promise<void> {
  await ctx.db
    .delete(authAttempts)
    .where(and(eq(authAttempts.scope, rule.scope), eq(authAttempts.subject, subject)));
}
