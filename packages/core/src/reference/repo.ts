import { and, asc, eq, ne, sql } from "drizzle-orm";
import { categories, platformSettings, quoteRequests, services } from "@occasion/db/schema";
import type { DbExecutor } from "../context.js";

/**
 * Database access for the reference data an administrator maintains:
 * the service categories, and the platform's own numbers.
 */

export type CategoryRow = {
  id: string;
  slug: string;
  name: string;
  tone: string | null;
  displayCount: number;
  sortOrder: number;
  active: boolean;
  /** How many listings are filed under it. The guard against deleting one. */
  serviceCount: number;
  /** Quote requests filed under it, which also pin it in place. */
  quoteRequestCount: number;
};

export async function listCategories(db: DbExecutor): Promise<CategoryRow[]> {
  // Joined and counted `distinct`, not a correlated subquery. Drizzle renders a
  // column inside a raw `sql` fragment without its table prefix, so the
  // subquery form compiles to `where "category_id" = "id"` — both of which
  // resolve against the *inner* table, comparing a service's category to its
  // own id and returning zero for every row. It is the failure mode the vendor
  // queue already documents, and it is silent: the numbers look plausible and
  // the delete guard opens.
  //
  // `distinct` is what makes the two joins safe together: without it each
  // child's rows multiply the other's.
  const serviceCount = sql<number>`count(distinct ${services.id})::int`;
  const quoteRequestCount = sql<number>`count(distinct ${quoteRequests.id})::int`;

  return db
    .select({
      id: categories.id,
      slug: categories.slug,
      name: categories.name,
      tone: categories.tone,
      displayCount: categories.displayCount,
      sortOrder: categories.sortOrder,
      active: categories.active,
      serviceCount,
      quoteRequestCount,
    })
    .from(categories)
    .leftJoin(services, eq(services.categoryId, categories.id))
    .leftJoin(quoteRequests, eq(quoteRequests.categoryId, categories.id))
    .groupBy(categories.id)
    .orderBy(asc(categories.sortOrder), asc(categories.name));
}

export async function loadCategory(
  db: DbExecutor,
  categoryId: string,
): Promise<CategoryRow | undefined> {
  const rows = await listCategories(db);
  return rows.find((row) => row.id === categoryId);
}

export async function slugTaken(db: DbExecutor, slug: string, exceptId?: string): Promise<boolean> {
  const [row] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(
      exceptId
        ? and(eq(categories.slug, slug), ne(categories.id, exceptId))
        : eq(categories.slug, slug),
    )
    .limit(1);

  return row !== undefined;
}

export async function insertCategory(
  db: DbExecutor,
  input: { slug: string; name: string; tone: string | null; sortOrder: number; now: Date },
): Promise<string> {
  const [row] = await db
    .insert(categories)
    .values({
      slug: input.slug,
      name: input.name,
      tone: input.tone,
      sortOrder: input.sortOrder,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .returning({ id: categories.id });

  return row?.id as string;
}

export async function updateCategory(
  db: DbExecutor,
  categoryId: string,
  input: { name?: string; slug?: string; tone?: string | null; active?: boolean; now: Date },
): Promise<void> {
  await db
    .update(categories)
    .set({
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.slug === undefined ? {} : { slug: input.slug }),
      ...(input.tone === undefined ? {} : { tone: input.tone }),
      ...(input.active === undefined ? {} : { active: input.active }),
      updatedAt: input.now,
    })
    .where(eq(categories.id, categoryId));
}

export async function setSortOrder(
  db: DbExecutor,
  categoryId: string,
  sortOrder: number,
  now: Date,
): Promise<void> {
  await db
    .update(categories)
    .set({ sortOrder, updatedAt: now })
    .where(eq(categories.id, categoryId));
}

export async function deleteCategory(db: DbExecutor, categoryId: string): Promise<void> {
  await db.delete(categories).where(eq(categories.id, categoryId));
}

/** The highest sort order in use, so a new category lands at the end. */
export async function maxSortOrder(db: DbExecutor): Promise<number> {
  const [row] = await db
    .select({ highest: sql<number>`coalesce(max(${categories.sortOrder}), -1)::int` })
    .from(categories);

  return row?.highest ?? -1;
}

export type SettingRow = {
  key: string;
  value: unknown;
  description: string | null;
  updatedAt: Date;
};

export async function listSettings(db: DbExecutor): Promise<SettingRow[]> {
  return db
    .select({
      key: platformSettings.key,
      value: platformSettings.value,
      description: platformSettings.description,
      updatedAt: platformSettings.updatedAt,
    })
    .from(platformSettings)
    .orderBy(asc(platformSettings.key));
}

export async function loadSetting(db: DbExecutor, key: string): Promise<SettingRow | undefined> {
  const [row] = await db
    .select({
      key: platformSettings.key,
      value: platformSettings.value,
      description: platformSettings.description,
      updatedAt: platformSettings.updatedAt,
    })
    .from(platformSettings)
    .where(eq(platformSettings.key, key))
    .for("update")
    .limit(1);

  return row;
}

export async function upsertSetting(
  db: DbExecutor,
  key: string,
  value: number | string,
  now: Date,
): Promise<void> {
  await db
    .insert(platformSettings)
    .values({ key, value, updatedAt: now })
    .onConflictDoUpdate({
      target: platformSettings.key,
      set: { value, updatedAt: now },
    });
}

/**
 * The numeric settings, as numbers, with a fallback per key.
 *
 * Separate from `listSettings` because the pricing path needs values and not
 * rows, and because a row holding something other than an integer is a
 * misconfiguration whose safe reading is the configured default — not `NaN`
 * travelling into an amount.
 */
export async function readNumbers(
  db: DbExecutor,
  fallbacks: Readonly<Record<string, number>>,
): Promise<Record<string, number>> {
  const rows = await db
    .select({ key: platformSettings.key, value: platformSettings.value })
    .from(platformSettings);

  const stored = new Map(rows.map((row) => [row.key, row.value]));
  const resolved: Record<string, number> = {};

  for (const [key, fallback] of Object.entries(fallbacks)) {
    const value = stored.get(key);
    resolved[key] = typeof value === "number" && Number.isInteger(value) ? value : fallback;
  }

  return resolved;
}
