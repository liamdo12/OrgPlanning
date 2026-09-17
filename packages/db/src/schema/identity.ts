import { relations } from "drizzle-orm";
import { index, jsonb, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { app, isDemo, timestamps } from "./common.js";
import { consentBasis, consentChannel, userRoleName, userStatus, vendorStatus } from "./enums.js";

/**
 * Accounts.
 *
 * `authProviderSub` is the auth provider's subject claim, kept as a plain
 * reference rather than a foreign key so the provider stays swappable. The row
 * here is the identity the rest of the schema points at.
 */
export const users = app.table(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    authProviderSub: text("auth_provider_sub").unique(),
    email: text("email").notNull().unique(),
    fullName: text("full_name").notNull(),
    phone: text("phone"),
    status: userStatus("status").notNull().default("unverified"),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    /**
     * Sessions issued before this instant are rejected. Suspending an account
     * or revoking a role moves it forward, which is what makes revocation take
     * effect immediately rather than whenever the current token expires.
     */
    sessionsValidAfter: timestamp("sessions_valid_after", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /**
     * When this person last had a verified second factor.
     *
     * Mirrored from the auth provider rather than read back from the session:
     * the provider's session object lists enrolled factors, but it arrives in a
     * cookie the browser controls, so a stolen password plus an edited cookie
     * would walk straight past the challenge. This column is the authority, and
     * `getActor` refuses a session that has not reached the second factor while
     * it is set.
     */
    mfaEnrolledAt: timestamp("mfa_enrolled_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    isDemo,
    ...timestamps,
  },
  (table) => [index("users_status_idx").on(table.status)],
);

/**
 * Role grants.
 *
 * Roles live here and are re-read on every request. A role encoded in a token
 * cannot be taken away before that token expires, so the token claim is only
 * ever treated as a cache.
 */
export const userRoles = app.table(
  "user_roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: userRoleName("role").notNull(),
    grantedBy: uuid("granted_by").references(() => users.id, { onDelete: "set null" }),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (table) => [
    unique("user_roles_user_role_key").on(table.userId, table.role),
    index("user_roles_user_idx").on(table.userId),
    index("user_roles_granted_by_idx").on(table.grantedBy),
  ],
);

/**
 * Vendor businesses.
 *
 * `hstRegistered` drives the money split: a registered vendor charges HST on
 * their own supply and remits it themselves, so that tax must reach them rather
 * than being withheld by the platform.
 */
export const vendors = app.table(
  "vendors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    tagline: text("tagline"),
    status: vendorStatus("status").notNull().default("pending"),
    /** Free-text home base shown in the admin queue, e.g. "Liberty Village". */
    baseArea: text("base_area"),
    stripeAccountId: text("stripe_account_id").unique(),
    /** Mirror of the connected account's onboarding state. */
    stripeStatus: text("stripe_status"),
    stripeChargesEnabled: timestamp("stripe_charges_enabled_at", { withTimezone: true }),
    stripePayoutsEnabled: timestamp("stripe_payouts_enabled_at", { withTimezone: true }),
    hstNumber: text("hst_number"),
    hstRegistered: timestamp("hst_registered_at", { withTimezone: true }),
    onboardingPercent: text("onboarding_percent"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    suspendedAt: timestamp("suspended_at", { withTimezone: true }),
    suspendedReason: text("suspended_reason"),
    isDemo,
    ...timestamps,
  },
  (table) => [index("vendors_status_idx").on(table.status)],
);

/** Staff attached to a vendor. */
export const vendorMembers = app.table(
  "vendor_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vendorId: uuid("vendor_id")
      .notNull()
      .references(() => vendors.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("owner"),
    ...timestamps,
  },
  (table) => [
    unique("vendor_members_vendor_user_key").on(table.vendorId, table.userId),
    index("vendor_members_user_idx").on(table.userId),
  ],
);

/**
 * Every consequential change, with the role the actor was acting under.
 *
 * The role matters as much as the actor: "who did this" is not answerable by
 * the user id alone once a person can hold more than one role.
 */
export const auditLog = app.table(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    actingRole: userRoleName("acting_role"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    ip: text("ip"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("audit_log_entity_idx").on(table.entityType, table.entityId),
    index("audit_log_actor_idx").on(table.actorUserId),
    index("audit_log_created_idx").on(table.createdAt),
  ],
);

/**
 * Consent to be contacted, per channel.
 *
 * Canadian anti-spam law treats express and implied consent differently and
 * implied consent expires, so this is a row with a basis and a timestamp rather
 * than a flag on the account. A broadcast checks it per recipient.
 */
export const communicationConsents = app.table(
  "communication_consents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    channel: consentChannel("channel").notNull(),
    basis: consentBasis("basis").notNull(),
    /** Implied consent lapses; express consent does not until withdrawn. */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    source: text("source"),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    unique("communication_consents_user_channel_key").on(table.userId, table.channel),
    index("communication_consents_user_idx").on(table.userId),
  ],
);

export const usersRelations = relations(users, ({ many }) => ({
  roles: many(userRoles),
  vendorMemberships: many(vendorMembers),
  consents: many(communicationConsents),
}));

export const vendorsRelations = relations(vendors, ({ many }) => ({
  members: many(vendorMembers),
}));

export const userRolesRelations = relations(userRoles, ({ one }) => ({
  user: one(users, { fields: [userRoles.userId], references: [users.id] }),
}));

export const vendorMembersRelations = relations(vendorMembers, ({ one }) => ({
  vendor: one(vendors, { fields: [vendorMembers.vendorId], references: [vendors.id] }),
  user: one(users, { fields: [vendorMembers.userId], references: [users.id] }),
}));
