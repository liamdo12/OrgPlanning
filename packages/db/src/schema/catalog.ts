import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  numeric,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { app, currency, money, timestamps, tstzrange, TABLE_PREFIX } from "./common.js";
import { bookingMode, priceUnit } from "./enums.js";
import { categories, neighbourhoods, policyTemplates } from "./reference.js";
import { users, vendors } from "./identity.js";

/** What a vendor sells. Source: the services list, lines 1950–1961. */
export const services = app.table(
  `${TABLE_PREFIX}services`,
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vendorId: uuid("vendor_id")
      .notNull()
      .references(() => vendors.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "restrict" }),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    description: text("description"),
    /** Headline price in cents, for the unit below. */
    basePrice: money("base_price").notNull(),
    currency,
    priceUnit: priceUnit("price_unit").notNull(),
    bookingMode: bookingMode("booking_mode").notNull(),
    /** Marketing pill on the discovery card, e.g. "Popular", "Top rated". */
    badge: text("badge"),
    /** Human service-area line, e.g. "Serves Downtown & West End". */
    areaLabel: text("area_label"),
    /**
     * The catalogue's headline sort, and so never null.
     *
     * Zero is what "nobody has reviewed this yet" means. Nullable, it sorted
     * above every rated business — `desc` puts NULLs first — and a keyset page
     * comparing a cursor against NULL matches neither side of the boundary, so
     * the row was unreachable at any offset.
     */
    ratingAverage: numeric("rating_average", { precision: 2, scale: 1 })
      .notNull()
      .default("0"),
    reviewCount: integer("review_count").notNull().default(0),
    /** Gradient stops the prototype renders in place of photography. */
    toneStart: text("tone_start"),
    toneEnd: text("tone_end"),
    /**
     * When the vendor made this service visible to customers.
     *
     * A timestamp, not the text it was declared as: nothing writes it yet —
     * publishing belongs to the vendor catalogue screen — and a column that
     * will hold an instant should not be the one place in the schema where a
     * date is a string waiting to be compared as one.
     */
    publishedAt: timestamp("published_at", { withTimezone: true }),
    /**
     * The cancellation policy this service is sold under.
     *
     * The deposit rate and the free-cancellation window are part of what the
     * business selling the date offers, so the attachment lives here and
     * checkout reads it off the priced line. A request naming its own template
     * could name a foreign one and hold a C$5,000 date for a 10% deposit.
     *
     * Null is an ordinary answer: the service then prices at
     * `platform_settings.deposit_bps`, which is what that setting is for.
     */
    policyTemplateId: uuid("policy_template_id").references(() => policyTemplates.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (table) => [
    index("services_vendor_idx").on(table.vendorId),
    index("services_category_idx").on(table.categoryId),
    index("services_policy_template_idx").on(table.policyTemplateId),
    // One per sort the discovery screen offers, each carrying the publication
    // condition every one of those queries also carries. An index on
    // `published_at` alone would have nothing to discriminate on — almost every
    // row is published — so the planner would never choose it; folded into the
    // sort key it satisfies the filter and the ordering in one scan.
    //
    // Both members run the same way, because the keyset predicate is a row
    // comparison: `(rating, id) < (value, id)` is the page after the cursor
    // only when the ordering is `rating desc, id desc`. `nullsFirst` on the
    // descending pair is not cosmetic — plain `order by x desc` means
    // `desc nulls first`, and an index built the other way round cannot satisfy
    // that ordering, so it is never chosen and every page sorts the table.
    index("services_rating_idx")
      .on(table.ratingAverage.desc().nullsFirst(), table.id.desc().nullsFirst())
      .where(sql`${table.publishedAt} is not null`),
    index("services_reviews_idx")
      .on(table.reviewCount.desc().nullsFirst(), table.id.desc().nullsFirst())
      .where(sql`${table.publishedAt} is not null`),
    index("services_price_idx")
      .on(table.basePrice.asc().nullsLast(), table.id.asc().nullsLast())
      .where(sql`${table.publishedAt} is not null`),
  ],
);

/** Named tiers within a service, e.g. Bloom & Co's "Classic" bouquet. */
export const servicePackages = app.table(
  `${TABLE_PREFIX}service_packages`,
  {
    id: uuid("id").primaryKey().defaultRandom(),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    unitPrice: money("unit_price").notNull(),
    currency,
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps,
  },
  (table) => [
    unique("service_packages_service_name_key").on(table.serviceId, table.name),
    index("service_packages_service_idx").on(table.serviceId),
  ],
);

export const serviceMedia = app.table(
  `${TABLE_PREFIX}service_media`,
  {
    id: uuid("id").primaryKey().defaultRandom(),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    altText: text("alt_text"),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps,
  },
  (table) => [
    index("service_media_service_idx").on(table.serviceId),
    // The results page reads up to three pictures per card in the same query as
    // the cards, by a lateral join ordered on `sort_order`. With the order in
    // the key that scan stops after three; on `service_id` alone it finds every
    // row for the service and sorts them, once per card.
    index("service_media_service_sort_idx").on(table.serviceId, table.sortOrder),
  ],
);

/** Where a service will travel. */
export const serviceAreas = app.table(
  `${TABLE_PREFIX}service_areas`,
  {
    id: uuid("id").primaryKey().defaultRandom(),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "cascade" }),
    neighbourhoodId: uuid("neighbourhood_id")
      .notNull()
      .references(() => neighbourhoods.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (table) => [
    unique("service_areas_service_neighbourhood_key").on(table.serviceId, table.neighbourhoodId),
    index("service_areas_service_idx").on(table.serviceId),
    index("service_areas_neighbourhood_idx").on(table.neighbourhoodId),
  ],
);

export const savedServices = app.table(
  `${TABLE_PREFIX}saved_services`,
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (table) => [
    unique("saved_services_user_service_key").on(table.userId, table.serviceId),
    index("saved_services_user_idx").on(table.userId),
    index("saved_services_service_idx").on(table.serviceId),
  ],
);

/** Whole days a vendor will not take work. */
export const blackoutDates = app.table(
  `${TABLE_PREFIX}blackout_dates`,
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vendorId: uuid("vendor_id")
      .notNull()
      .references(() => vendors.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
    reason: text("reason"),
    ...timestamps,
  },
  (table) => [
    unique("blackout_dates_vendor_day_key").on(table.vendorId, table.day),
    index("blackout_dates_vendor_idx").on(table.vendorId),
  ],
);

/**
 * Time a service is committed for.
 *
 * The exclusion constraint added in the roles migration is what actually
 * prevents a double booking: two active blocks for one service whose ranges
 * overlap are rejected by the database, not by whichever code path happened to
 * check first.
 */
export const capacityBlocks = app.table(
  `${TABLE_PREFIX}capacity_blocks`,
  {
    id: uuid("id").primaryKey().defaultRandom(),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "cascade" }),
    /**
     * References `orders.id`. The constraint is declared in the roles
     * migration rather than here: `ordering` already imports this module, so
     * declaring it would make the two circular.
     */
    orderId: uuid("order_id"),
    /** Half-open range: `[start, end)`, so touching bookings do not collide. */
    during: tstzrange("during").notNull(),
    /**
     * Released blocks stay for history. Only active ones participate in the
     * overlap constraint, so cancelling an order frees the slot without
     * deleting the record that it was ever held.
     */
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (table) => [
    index("capacity_blocks_service_idx").on(table.serviceId),
    index("capacity_blocks_order_idx").on(table.orderId),
  ],
);

/** Per-day headroom for services sold by volume rather than by slot. */
export const dailyCapacity = app.table(
  `${TABLE_PREFIX}daily_capacity`,
  {
    id: uuid("id").primaryKey().defaultRandom(),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
    total: integer("total").notNull(),
    remaining: integer("remaining").notNull(),
    ...timestamps,
  },
  (table) => [
    unique("daily_capacity_service_day_key").on(table.serviceId, table.day),
    check("daily_capacity_remaining_non_negative", sql`${table.remaining} >= 0`),
    check("daily_capacity_remaining_within_total", sql`${table.remaining} <= ${table.total}`),
  ],
);
