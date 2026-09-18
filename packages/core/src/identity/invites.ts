import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { adminInvites } from "@occasion/db/schema";
import type { CoreContext } from "../context.js";
import { NotFoundError, ValidationError } from "../errors.js";
import { record } from "../audit/service.js";
import type { Actor } from "./actor.js";
import { requireAdmin } from "./service.js";
import * as repo from "./repo.js";

/**
 * Administrator invitations.
 *
 * The only path by which a new person becomes an administrator. Self-service
 * signup validates its role against a closed set that excludes `admin`, and
 * `grantRole` already requires an administrator — so this closes the loop: an
 * existing admin opens the door, and the row records who.
 *
 * The token is generated here rather than accepted from a caller, and only its
 * hash is stored: the secret is the one property that makes an invitation safe,
 * and neither leaving it to a caller nor keeping it in plaintext is a way to
 * protect it. A read-only leak of this table must not be an instant admin grant.
 */

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Tokens are looked up by hash, so the plaintext exists only in the email. */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type AdminInvite = {
  id: string;
  email: string;
  token: string;
  expiresAt: Date;
};

export async function inviteAdmin(
  ctx: CoreContext,
  actor: Actor,
  email: string,
): Promise<AdminInvite> {
  const admin = requireAdmin(actor);
  const now = ctx.clock.now();
  const normalised = email.trim().toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalised)) {
    throw new ValidationError("Enter a valid email address.", { email: "invalid" });
  }

  const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);
  const token = randomBytes(32).toString("base64url");

  const [row] = await ctx.db
    .insert(adminInvites)
    .values({
      email: normalised,
      token: hashToken(token),
      invitedByUserId: admin.userId,
      expiresAt,
    })
    .returning({ id: adminInvites.id });

  await record(ctx, actor, {
    action: "identity.admin.invite",
    entityType: "admin_invite",
    entityId: row?.id,
    after: { email: normalised, expiresAt },
  });

  return { id: row?.id as string, email: normalised, token, expiresAt };
}

/**
 * Redeems an invitation and grants the role.
 *
 * Every check is made against the row rather than the link: expiry, whether it
 * was already used, and whether it was withdrawn. A link that has been
 * forwarded, screenshotted or left in an inbox for a month is exactly what
 * this has to refuse.
 *
 * Grants the role directly rather than through `grantRole`, because the
 * accepting person is not an administrator yet and could not pass that gate.
 * The invitation is the authorisation, and the audit row names the inviter.
 */
export async function acceptAdminInvite(
  ctx: CoreContext,
  token: string,
  acceptingUserId: string,
): Promise<void> {
  const now = ctx.clock.now();

  const identity = await repo.loadIdentity(ctx.db, acceptingUserId);
  if (!identity) {
    throw new NotFoundError("No such account.");
  }

  // A suspended or still-unverified account must not collect the admin role by
  // holding a link. Proving control of the mailbox comes first.
  if (identity.status !== "active") {
    throw new NotFoundError("This account cannot accept an invitation yet.");
  }

  // Claim and validate in one statement. A select-then-update leaves a window
  // in which a second redemption, or a concurrent revocation, slips between the
  // two — so single-use would be a convention rather than a guarantee.
  const [invite] = await ctx.db
    .update(adminInvites)
    .set({ acceptedAt: now, acceptedUserId: acceptingUserId, updatedAt: now })
    .where(
      and(
        eq(adminInvites.token, hashToken(token)),
        eq(adminInvites.email, identity.email.toLowerCase()),
        isNull(adminInvites.acceptedAt),
        isNull(adminInvites.revokedAt),
      ),
    )
    .returning({
      id: adminInvites.id,
      email: adminInvites.email,
      expiresAt: adminInvites.expiresAt,
      invitedByUserId: adminInvites.invitedByUserId,
    });

  // One answer for "no such token", "already used", "withdrawn" and
  // "addressed to someone else": the differences would each be a probe.
  if (!invite) {
    throw new NotFoundError("This invitation is no longer valid.");
  }

  if (invite.expiresAt <= now) {
    throw new NotFoundError("This invitation has expired.");
  }

  await repo.insertRole(ctx.db, acceptingUserId, "admin", invite.invitedByUserId, now);
  await repo.bumpSessionsValidAfter(ctx.db, acceptingUserId, ctx.clock.realNow());

  await record(
    ctx,
    {
      kind: "user",
      userId: acceptingUserId,
      email: identity.email,
      status: identity.status,
      roles: [...identity.roles, "admin"],
      activeRole: "admin",
      vendorIds: identity.vendorIds,
    },
    {
      action: "identity.admin.invite.accept",
      entityType: "user",
      entityId: acceptingUserId,
      before: { roles: identity.roles },
      after: { roles: [...identity.roles, "admin"], invitedBy: invite.invitedByUserId },
    },
  );
}

export async function revokeAdminInvite(
  ctx: CoreContext,
  actor: Actor,
  inviteId: string,
): Promise<void> {
  requireAdmin(actor);
  const now = ctx.clock.now();

  await ctx.db
    .update(adminInvites)
    .set({ revokedAt: now, updatedAt: now })
    .where(and(eq(adminInvites.id, inviteId), isNull(adminInvites.acceptedAt)));

  await record(ctx, actor, {
    action: "identity.admin.invite.revoke",
    entityType: "admin_invite",
    entityId: inviteId,
  });
}
