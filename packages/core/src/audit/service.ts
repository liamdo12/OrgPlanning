import { auditLog } from "@occasion/db/schema";
import type { CoreContext } from "../context.js";
import type { Actor, RoleName } from "../identity/actor.js";
import { isAuthenticated } from "../identity/actor.js";

/**
 * The record of who changed what.
 *
 * Two things make an entry useful a year later: the role the person was acting
 * under, and the before/after state. The role matters as much as the identity —
 * once someone can hold more than one, "the admin did it" and "they did it
 * while browsing as a customer" are different facts, and only one of them is
 * an admin action.
 */

export type AuditEntry = {
  action: string;
  entityType: string;
  entityId?: string | undefined;
  before?: unknown;
  after?: unknown;
  ip?: string | undefined;
};

/**
 * Writes an audit row.
 *
 * Takes the actor rather than reading it from the context so that a caller
 * cannot accidentally attribute an action to whoever happens to be signed in
 * while a job runs on someone else's behalf.
 */
export async function record(ctx: CoreContext, actor: Actor, entry: AuditEntry): Promise<void> {
  const actorUserId = isAuthenticated(actor) ? actor.userId : null;
  const actingRole: RoleName | null = isAuthenticated(actor) ? actor.activeRole : null;

  await ctx.db.insert(auditLog).values({
    actorUserId,
    actingRole,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
    ip: entry.ip ?? null,
    createdAt: ctx.clock.realNow(),
  });
}
