import { boolean, integer, jsonb, numeric, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { app, timestamps, TABLE_PREFIX } from "./common.js";
import { placeKind, policyTier } from "./enums.js";

/** Service categories. Source: categories(), lines 1967–1973. */
export const categories = app.table(`${TABLE_PREFIX}categories`, {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  /** Listing count shown on the discovery tiles, not a computed total. */
  displayCount: integer("display_count").notNull().default(0),
  sortOrder: integer("sort_order").notNull().default(0),
  /**
   * The category's own colour, as a CSS background.
   *
   * The prototype draws a category as a gradient tile and gives it no icon at
   * all (`cats()`, lines 1967–1973), so this is the editable visual the screen
   * needs — a glyph field would have nothing to render.
   */
  tone: text("tone"),
  /**
   * Whether the category is offered.
   *
   * Deactivating is the answer to "delete a category that has services": the
   * listings keep the category they were filed under, and a delete is refused
   * while anything points at it.
   *
   * **Nothing reads this yet.** The screen that files a service under a
   * category is the vendor catalogue, which this milestone does not build, so
   * the flag records the operator's decision and the listing editor is what
   * will honour it. Recorded in `docs/design-gaps.md` rather than left as a
   * column that looks enforced.
   */
  active: boolean("active").notNull().default(true),
  ...timestamps,
});

/**
 * Toronto places used for search and service areas. Source: places(),
 * lines 1915–1932.
 *
 * Coordinates are plain numerics rather than a geography type: the map is out
 * of scope for this milestone, and these columns convert to `geography` later
 * without any application code changing.
 */
export const neighbourhoods = app.table(`${TABLE_PREFIX}neighbourhoods`, {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  kind: placeKind("kind").notNull(),
  /** Descriptive line under the name in the search list. */
  subtitle: text("subtitle"),
  postalPrefix: text("postal_prefix"),
  /** Free-text search tokens carried over from the prototype. */
  searchTags: text("search_tags"),
  latitude: numeric("latitude", { precision: 9, scale: 6 }),
  longitude: numeric("longitude", { precision: 9, scale: 6 }),
  sortOrder: integer("sort_order").notNull().default(0),
  ...timestamps,
});

/**
 * Cancellation policy families a vendor can attach to a service.
 * Source: the policy selector, line 1889 (`Moderate` is the seeded default).
 */
export const policyTemplates = app.table(`${TABLE_PREFIX}policy_templates`, {
  id: uuid("id").primaryKey().defaultRandom(),
  tier: policyTier("tier").notNull().unique(),
  name: text("name").notNull(),
  summary: text("summary").notNull(),
  /**
   * What the deposit is, in basis points of the total.
   *
   * A column rather than a platform-wide rate because the deposit is part of
   * the policy the vendor chose — 10% flexible, 20% moderate, 30% strict — and
   * an order carries the template it was booked under. The platform setting of
   * the same name is the fallback for an order with no template attached.
   */
  depositBps: integer("deposit_bps").notNull(),
  /** Hours after the deposit during which a customer may cancel for free. */
  freeCancellationHours: integer("free_cancellation_hours").notNull(),
  /** Percentage refunded after the free window, in basis points. */
  lateRefundBps: integer("late_refund_bps").notNull(),
  ...timestamps,
});

/**
 * Platform-wide settings, one row per key.
 *
 * Rates live here rather than in code so an admin screen can show what is
 * actually in force; the value is jsonb so a setting can grow a shape.
 */
export const platformSettings = app.table(`${TABLE_PREFIX}platform_settings`, {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  description: text("description"),
  ...timestamps,
});

/**
 * One row, written by the seed.
 *
 * Every seeded date is stored as an offset from `anchorAt`, not as a literal.
 * That is what keeps the four demo clock states meaningful: reseeding in six
 * months still produces "deposit paid 2 days ago, event in 186 days" rather
 * than a pile of dates in the past.
 */
export const seedMeta = app.table(`${TABLE_PREFIX}seed_meta`, {
  id: uuid("id").primaryKey().defaultRandom(),
  anchorAt: timestamp("anchor_at", { withTimezone: true }).notNull(),
  seededAt: timestamp("seeded_at", { withTimezone: true }).notNull().defaultNow(),
  /** Which seed revision produced these rows. */
  revision: text("revision").notNull().unique(),
  notes: text("notes"),
});
