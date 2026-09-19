import { record } from "../audit/service.js";
import type { CoreContext } from "../context.js";
import { NotFoundError, ValidationError } from "../errors.js";
import type { Actor } from "../identity/actor.js";
import { requireAdmin } from "../identity/service.js";
import { DEFAULT_ORDERING_POLICY } from "../ordering/service.js";
import * as repo from "./repo.js";
import {
  SETTING_SPECS,
  formatSettingValue,
  parseSettingValue,
  specFor,
  type SettingKey,
  type SettingSpec,
} from "./settings.js";

/**
 * The reference data an administrator maintains: categories, and the platform's
 * own numbers.
 *
 * Everything here is administrative — a category belongs to the platform rather
 * than to a person, and there is no second party a policy could be asked about
 * — so `requireAdmin()` is the whole authorization story and the matrix says
 * so. What the functions below do have is the other kind of guard: a category
 * that something is filed under cannot be deleted, and a rate cannot be set to
 * a number that would make an order's arithmetic refuse itself.
 */

export type AdminCategory = repo.CategoryRow & {
  /** Whether it can be deleted outright, and why not when it cannot. */
  deletable: boolean;
  inUseBy: string | null;
};

export async function listCategories(ctx: CoreContext, actor: Actor): Promise<AdminCategory[]> {
  requireAdmin(actor);

  const rows = await repo.listCategories(ctx.db);
  return rows.map(describe);
}

function describe(row: repo.CategoryRow): AdminCategory {
  const parts = [
    ...(row.serviceCount > 0
      ? [`${row.serviceCount} service${row.serviceCount === 1 ? "" : "s"}`]
      : []),
    ...(row.quoteRequestCount > 0
      ? [`${row.quoteRequestCount} quote request${row.quoteRequestCount === 1 ? "" : "s"}`]
      : []),
  ];

  return {
    ...row,
    deletable: parts.length === 0,
    inUseBy: parts.length === 0 ? null : parts.join(" and "),
  };
}

/**
 * A slug, from a name.
 *
 * Generated rather than typed, because the slug is what a URL and a seeded id
 * are built from and a hand-typed one drifts from the name it is supposed to
 * mirror. It is still editable afterwards; this is only the default.
 */
export function slugify(name: string): string {
  return (
    name
      .normalize("NFKD")
      // Strip the accents rather than the letters: "Décor" becomes "decor", not
      // "dcor".
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
  );
}

export async function createCategory(
  ctx: CoreContext,
  actor: Actor,
  input: { name: string; slug?: string | undefined; tone?: string | undefined },
): Promise<string> {
  requireAdmin(actor);

  const name = input.name.trim();
  if (!name) throw new ValidationError("A category needs a name.", { name: "required" });

  const slug = (input.slug?.trim() || slugify(name)).slice(0, 60);
  if (!slug) {
    throw new ValidationError("That name does not produce a usable slug.", { slug: "empty" });
  }

  const now = ctx.clock.now();

  return ctx.db.transaction(async (tx) => {
    if (await repo.slugTaken(tx, slug)) {
      throw new ValidationError(`There is already a category at ${slug}.`, { slug: "taken" });
    }

    const categoryId = await repo.insertCategory(tx, {
      slug,
      name: name.slice(0, 80),
      tone: input.tone?.trim() || null,
      sortOrder: (await repo.maxSortOrder(tx)) + 1,
      now,
    });

    await record(
      ctx,
      actor,
      {
        action: "category.create",
        entityType: "category",
        entityId: categoryId,
        after: { slug, name: name.slice(0, 80) },
      },
      tx,
    );

    return categoryId;
  });
}

export async function updateCategory(
  ctx: CoreContext,
  actor: Actor,
  categoryId: string,
  input: {
    name?: string | undefined;
    slug?: string | undefined;
    tone?: string | undefined;
    active?: boolean | undefined;
  },
): Promise<void> {
  requireAdmin(actor);

  const now = ctx.clock.now();

  await ctx.db.transaction(async (tx) => {
    const before = await repo.loadCategory(tx, categoryId);
    if (!before) throw new NotFoundError("No such category.");

    const name = input.name?.trim();
    if (input.name !== undefined && !name) {
      throw new ValidationError("A category needs a name.", { name: "required" });
    }

    const slug = input.slug?.trim();
    if (slug && (await repo.slugTaken(tx, slug, categoryId))) {
      throw new ValidationError(`There is already a category at ${slug}.`, { slug: "taken" });
    }

    await repo.updateCategory(tx, categoryId, {
      ...(name === undefined ? {} : { name: name.slice(0, 80) }),
      ...(slug === undefined ? {} : { slug: slug.slice(0, 60) }),
      ...(input.tone === undefined ? {} : { tone: input.tone.trim() || null }),
      ...(input.active === undefined ? {} : { active: input.active }),
      now,
    });

    await record(
      ctx,
      actor,
      {
        action: "category.update",
        entityType: "category",
        entityId: categoryId,
        before: { name: before.name, slug: before.slug, tone: before.tone, active: before.active },
        after: {
          name: name ?? before.name,
          slug: slug ?? before.slug,
          tone: input.tone === undefined ? before.tone : input.tone.trim() || null,
          active: input.active ?? before.active,
        },
      },
      tx,
    );
  });
}

/**
 * Moves a category one place up or down the list.
 *
 * Buttons rather than dragging, which is the non-drag alternative the plan asks
 * for and is also the only one that works from a keyboard without a bespoke
 * implementation of drag-and-drop semantics nobody would test.
 *
 * The whole list is renumbered inside the transaction rather than the two rows
 * swapped, because the seeded orders are contiguous only by accident and a swap
 * between two rows that share a sort order does nothing at all.
 */
export async function moveCategory(
  ctx: CoreContext,
  actor: Actor,
  categoryId: string,
  direction: "up" | "down",
): Promise<void> {
  requireAdmin(actor);

  const now = ctx.clock.now();

  await ctx.db.transaction(async (tx) => {
    const rows = await repo.listCategories(tx);
    const index = rows.findIndex((row) => row.id === categoryId);
    if (index < 0) throw new NotFoundError("No such category.");

    const target = direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= rows.length) {
      throw new ValidationError("That category is already at the end of the list.", {
        direction: "at_edge",
      });
    }

    const ordered = [...rows];
    const [moved] = ordered.splice(index, 1);
    ordered.splice(target, 0, moved as repo.CategoryRow);

    for (const [position, row] of ordered.entries()) {
      if (row.sortOrder !== position) {
        await repo.setSortOrder(tx, row.id, position, now);
      }
    }

    await record(
      ctx,
      actor,
      {
        action: "category.reorder",
        entityType: "category",
        entityId: categoryId,
        before: { position: index },
        after: { position: target, order: ordered.map((row) => row.slug) },
      },
      tx,
    );
  });
}

/**
 * Deletes a category nothing is filed under.
 *
 * The guard is the point. A category with services is the one somebody actually
 * wants to get rid of, and deleting it would either orphan those listings or
 * take them with it; deactivating is what that case needs, and the message says
 * so rather than leaving somebody to guess.
 */
export async function deleteCategory(
  ctx: CoreContext,
  actor: Actor,
  categoryId: string,
): Promise<void> {
  requireAdmin(actor);

  await ctx.db.transaction(async (tx) => {
    // Read inside the transaction: a listing filed under this category between
    // the check and the delete would otherwise slip through, and the answer
    // would be a foreign-key error several layers below the button.
    const before = await repo.loadCategory(tx, categoryId);
    if (!before) throw new NotFoundError("No such category.");

    const described = describe(before);
    if (!described.deletable) {
      throw new ValidationError(
        `${before.name} has ${described.inUseBy}. Deactivate it instead — the listings keep the category they were filed under, and nothing new can be filed under it.`,
        { category: "in_use" },
      );
    }

    await repo.deleteCategory(tx, categoryId);

    await record(
      ctx,
      actor,
      {
        action: "category.delete",
        entityType: "category",
        entityId: categoryId,
        before: { slug: before.slug, name: before.name },
        // A delete has an after, and it is the fact that there is nothing
        // there. An entry with a before and no after reads, months later, like
        // one whose second half failed to be written.
        after: { deleted: true },
      },
      tx,
    );
  });
}

export type AdminSetting = SettingSpec & {
  value: unknown;
  display: string;
  updatedAt: Date | null;
};

/**
 * Every setting, whether or not a row exists for it.
 *
 * Driven by the specification rather than by the table: a key the seed has
 * never written is still a number the platform uses, and a screen that listed
 * only the rows would hide it.
 */
export async function listSettings(ctx: CoreContext, actor: Actor): Promise<AdminSetting[]> {
  requireAdmin(actor);

  const rows = new Map((await repo.listSettings(ctx.db)).map((row) => [row.key, row]));

  return SETTING_SPECS.map((spec) => {
    const row = rows.get(spec.key);
    const value = row?.value ?? fallbackFor(ctx, spec.key);

    return {
      ...spec,
      value,
      display: formatSettingValue(spec.key, value),
      updatedAt: row?.updatedAt ?? null,
    };
  });
}

export async function updateSetting(
  ctx: CoreContext,
  actor: Actor,
  key: string,
  raw: string,
): Promise<void> {
  requireAdmin(actor);

  const spec = specFor(key);
  const value = parseSettingValue(key, raw);
  const now = ctx.clock.now();

  await ctx.db.transaction(async (tx) => {
    // Locked, then read: the entry records what it changed from, and a value
    // read outside the lock can be stale by the time it is written down.
    const before = await repo.loadSetting(tx, key);

    await repo.upsertSetting(tx, key, value, now);

    await record(
      ctx,
      actor,
      {
        action: "settings.update",
        entityType: "platform_setting",
        // No `entityId`: the column is a uuid and a setting is keyed by name,
        // so the key goes in the payload where it can be read back as itself.
        before: { key, value: before?.value ?? null },
        after: { key, value, label: spec.label },
      },
      tx,
    );
  });
}

/** What a setting is when the table has no row for it. */
function fallbackFor(ctx: CoreContext, key: SettingKey): unknown {
  switch (key) {
    case "commission_bps":
      return ctx.config.commissionBps;
    case "hst_bps":
      return ctx.config.hstBps;
    case "deposit_bps":
      return DEFAULT_ORDERING_POLICY.defaultDepositBps;
    case "cooling_window_hours":
      return DEFAULT_ORDERING_POLICY.coolingWindowHours;
    case "balance_lead_days":
      return DEFAULT_ORDERING_POLICY.balanceLeadDays;
    case "currency":
      return ctx.config.currency;
    default:
      return null;
  }
}
