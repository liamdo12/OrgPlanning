import { eq, sql } from "drizzle-orm";
import { platformSettings } from "@occasion/db/schema";
import { record } from "../audit/service.js";
import type { CoreContext } from "../context.js";
import { ValidationError } from "../errors.js";
import { isAuthenticated, type Actor } from "../identity/actor.js";
import { requireAdmin } from "../identity/service.js";

/**
 * The admin clock override: what it is, where it lives, and what it may do.
 *
 * **It is a preview.** Setting it changes what the ops screen *lists* as due.
 * It does not change what the job runner *claims* on its own — the cron tick
 * passes the real clock and can never see it. The one place it executes
 * anything is the "Run due jobs" button, which passes it explicitly and also
 * passes `demoOnly`, so a shifted clock can only ever touch demo-flagged rows.
 *
 * That split is the whole design, and it is not theoretical. With the runner
 * reading a shifted clock directly, one jump to `event − 14 days` would claim
 * every future balance charge on the platform, charge those cards, and consume
 * the dedupe keys — which would then make the real run, on the real date, a
 * silent no-op. There would be no error anywhere.
 *
 * **It is stored, not signed into a cookie.** A cookie the browser holds is a
 * cookie the browser can write, and a forged one would shift time for whoever
 * sent it. This is a row, keyed by the administrator who set it, so forging it
 * requires already being able to write the database.
 *
 * **It always expires.** An override left on is a demo that quietly stops being
 * the present, and every date on every screen drifts with it.
 */

/** How long an override lasts before the real clock comes back on its own. */
export const OVERRIDE_TTL_MINUTES = 120;

export type StoredOverride = {
  /** The instant the system should pretend it is. */
  effectiveAt: Date;
  /** The administrator who set it. Recorded on every job run it touches. */
  actorUserId: string;
  expiresAt: Date;
};

/** One row per administrator, so two of them cannot fight over one clock. */
function keyFor(userId: string): string {
  return `clock_override:${userId}`;
}

/**
 * Whether this deployment may move time at all.
 *
 * `APP_TIER`, never `NODE_ENV`: the deployed demo is a production *build* that
 * must still demo the clock, and a production deployment of that same build
 * must refuse. `createCoreContext` already refuses to construct a production
 * context with the flag on, so this is the second of two gates rather than the
 * only one.
 */
export function assertOverrideAllowed(ctx: CoreContext): void {
  if (!ctx.config.allowClockOverride || ctx.config.appTier === "production") {
    throw new ValidationError("The clock override is not available on this deployment.", {
      tier: "refused",
    });
  }
}

/**
 * The override this administrator has set, if it has not lapsed.
 *
 * An expired row reads as no override rather than being deleted here: reading
 * is done on a page render, and a read that writes is a read that can fail for
 * a reason the reader did not ask about.
 */
export async function readOverride(
  ctx: CoreContext,
  userId: string,
): Promise<StoredOverride | null> {
  if (!ctx.config.allowClockOverride || ctx.config.appTier === "production") return null;

  const [row] = await ctx.db
    .select({ value: platformSettings.value })
    .from(platformSettings)
    .where(eq(platformSettings.key, keyFor(userId)))
    .limit(1);

  if (!row) return null;

  const stored = row.value as { effectiveAt?: unknown; expiresAt?: unknown };
  const effectiveAt = new Date(String(stored.effectiveAt));
  const expiresAt = new Date(String(stored.expiresAt));

  if (Number.isNaN(effectiveAt.getTime()) || Number.isNaN(expiresAt.getTime())) return null;
  if (expiresAt.getTime() <= ctx.clock.realNow().getTime()) return null;

  return { effectiveAt, actorUserId: userId, expiresAt };
}

/**
 * Moves this administrator's preview clock.
 *
 * Audited, because a payout made under a shifted clock has to be explainable
 * from the record rather than from somebody's memory of which button they
 * pressed.
 */
export async function setOverride(
  ctx: CoreContext,
  actor: Actor,
  effectiveAt: Date,
): Promise<StoredOverride> {
  requireAdmin(actor);
  assertOverrideAllowed(ctx);

  if (Number.isNaN(effectiveAt.getTime())) {
    throw new ValidationError("That is not a moment in time.", { effectiveAt: "invalid" });
  }
  if (!isAuthenticated(actor)) {
    throw new ValidationError("An override belongs to whoever set it.", { actor: "anonymous" });
  }

  const expiresAt = new Date(ctx.clock.realNow().getTime() + OVERRIDE_TTL_MINUTES * 60_000);
  const override: StoredOverride = { effectiveAt, actorUserId: actor.userId, expiresAt };

  await ctx.db
    .insert(platformSettings)
    .values({
      key: keyFor(actor.userId),
      value: { effectiveAt: effectiveAt.toISOString(), expiresAt: expiresAt.toISOString() },
      description: "Admin clock override. Preview only; execution is limited to demo rows.",
    })
    .onConflictDoUpdate({
      target: platformSettings.key,
      set: {
        value: { effectiveAt: effectiveAt.toISOString(), expiresAt: expiresAt.toISOString() },
        updatedAt: ctx.clock.realNow(),
      },
    });

  await record(ctx, actor, {
    action: "ops.clock_override.set",
    entityType: "platform",
    after: { effectiveAt: effectiveAt.toISOString(), expiresAt: expiresAt.toISOString() },
  });

  return override;
}

/** Puts the real clock back. */
export async function clearOverride(ctx: CoreContext, actor: Actor): Promise<void> {
  requireAdmin(actor);
  if (!isAuthenticated(actor)) return;

  await ctx.db.delete(platformSettings).where(eq(platformSettings.key, keyFor(actor.userId)));

  await record(ctx, actor, {
    action: "ops.clock_override.clear",
    entityType: "platform",
    after: { effectiveAt: null },
  });
}

/**
 * Clears every administrator's override.
 *
 * Called by the reseed, because a reseed moves the anchor every seeded date is
 * measured from — so an override set against the old anchor points at a moment
 * that no longer means what it meant when it was chosen.
 */
export async function clearAllOverrides(ctx: CoreContext): Promise<number> {
  // Matched on the key prefix, not on "every settings row": this table also
  // holds the commission and tax rates, and a reseed that wiped those would
  // take the platform's economics with the demo data.
  //
  // The underscore is escaped because `_` is a single-character wildcard in
  // `like`. Nothing collides today, but this is a `delete` and the pattern
  // should mean what it looks like it means.
  const cleared = await ctx.db
    .delete(platformSettings)
    .where(sql`${platformSettings.key} like 'clock\_override:%' escape '\'`)
    .returning({ key: platformSettings.key });

  return cleared.length;
}

/**
 * The time a listing should be read at.
 *
 * Named `previewNow` rather than `now` so that every call site says out loud
 * which of the two clocks it wanted. Anything that writes uses `ctx.clock`.
 */
export function previewNow(ctx: CoreContext, override: StoredOverride | null): Date {
  return override?.effectiveAt ?? ctx.clock.now();
}
