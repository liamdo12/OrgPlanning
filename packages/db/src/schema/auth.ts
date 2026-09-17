import { index, integer, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { app, timestamps, TABLE_PREFIX } from "./common.js";
import { users } from "./identity.js";

/**
 * Counted attempts at a rate-limited endpoint.
 *
 * A database counter rather than an in-memory one: the app runs as more than
 * one process, and a limiter that each process keeps to itself multiplies the
 * real limit by the number of running instances. A shared cache replaces this
 * when there is one.
 *
 * `scope` is what is being limited (`login`, `password_reset`) and `subject` is
 * who — an email address or a client address. Both are needed: limiting only by
 * address punishes everyone behind one NAT, and limiting only by email lets an
 * attacker walk a list of accounts.
 */
export const authAttempts = app.table(
  `${TABLE_PREFIX}auth_attempts`,
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scope: text("scope").notNull(),
    subject: text("subject").notNull(),
    /** Start of the window this row counts. */
    windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    /** Set when the limit is hit, so the answer does not have to be recomputed. */
    blockedUntil: timestamp("blocked_until", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    unique("auth_attempts_scope_subject_window_key").on(
      table.scope,
      table.subject,
      table.windowStartedAt,
    ),
  ],
);

/**
 * An invitation to become an administrator.
 *
 * Administrators are never self-service. An existing admin creates one of
 * these; accepting it is the only path by which the `admin` role is granted to
 * a new person, and the row records who opened that door.
 */
export const adminInvites = app.table(
  `${TABLE_PREFIX}admin_invites`,
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    /** Opaque and single-use, like every other emailed token. */
    token: text("token").notNull().unique(),
    // Referenced, not bare: `user_roles.granted_by` does have a foreign key, so
    // a stale inviter id here would surface as a constraint violation at the
    // moment someone redeems the invitation.
    invitedByUserId: uuid("invited_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedUserId: uuid("accepted_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("admin_invites_email_idx").on(table.email),
    index("admin_invites_invited_by_idx").on(table.invitedByUserId),
    index("admin_invites_accepted_user_idx").on(table.acceptedUserId),
  ],
);
