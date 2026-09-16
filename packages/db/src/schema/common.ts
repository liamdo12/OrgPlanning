import { bigint, boolean, char, customType, pgSchema, timestamp } from "drizzle-orm/pg-core";

/**
 * Every application table lives in the `app` schema, kept apart from the auth
 * provider's own tables so the provider can be replaced without a migration
 * touching our data.
 */
export const app = pgSchema("app");

/** Timestamps every table carries. */
export const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

/**
 * Money is integer cents. A float cannot represent C$0.10, and a marketplace
 * that splits every amount three ways between customer, vendor and platform
 * accumulates that error until the books stop balancing.
 */
export function money(name: string) {
  return bigint(name, { mode: "bigint" });
}

/** Currency is a column rather than an assumption, even while only CAD exists. */
export const currency = char("currency", { length: 3 }).notNull().default("CAD");

/**
 * Marks a row as demo data.
 *
 * This is the boundary that makes the admin clock override safe: under an
 * override the job runner may only touch rows where this is true, and the
 * reseed may only delete them. Without it, jumping the clock forward would
 * charge every real balance that is due before the new "now".
 */
export const isDemo = boolean("is_demo").notNull().default(false);

/**
 * A Postgres `tstzrange`, e.g. `["2027-03-20 17:00+00","2027-03-20 21:00+00")`.
 *
 * Drizzle has no range type of its own, but the range is the point: it is what
 * lets an exclusion constraint reject an overlapping booking inside the
 * database, rather than trusting whichever code path checked first.
 */
export const tstzrange = customType<{ data: string; driverData: string }>({
  dataType: () => "tstzrange",
});
