"use server";

import { revalidatePath } from "next/cache";
import {
  AppError,
  createCategory,
  deleteCategory,
  moveCategory,
  updateCategory,
} from "@occasion/core";
import { requireAdminActor } from "../../../../lib/auth-guard";
import { createRequestContext } from "../../../../lib/core";
import { readString } from "../../../../lib/form-values";

/**
 * The categories screen's actions.
 *
 * `requireAdminActor()` as the first statement, because a server action is
 * reachable by a direct POST that renders no layout at all — and the domain
 * then checks again, because this file is not the only thing that will ever
 * call it.
 */

export type CategoryActionState = {
  error?: string;
  message?: string;
};

async function run(work: () => Promise<string>): Promise<CategoryActionState> {
  try {
    const message = await work();
    revalidatePath("/admin/categories");
    return { message };
  } catch (error) {
    if (error instanceof AppError) {
      return { error: error.message };
    }
    throw error;
  }
}

export async function createCategoryAction(
  _previous: CategoryActionState,
  form: FormData,
): Promise<CategoryActionState> {
  const actor = await requireAdminActor();
  const ctx = createRequestContext();

  return run(async () => {
    const name = readString(form, "name");
    await createCategory(ctx, actor, {
      name,
      slug: readString(form, "slug"),
      tone: readString(form, "tone"),
    });
    return `${name.trim()} added, at the end of the list.`;
  });
}

export async function updateCategoryAction(
  _previous: CategoryActionState,
  form: FormData,
): Promise<CategoryActionState> {
  const actor = await requireAdminActor();
  const ctx = createRequestContext();

  return run(async () => {
    await updateCategory(ctx, actor, readString(form, "categoryId"), {
      name: readString(form, "name"),
      slug: readString(form, "slug"),
      tone: readString(form, "tone"),
    });
    return "Saved.";
  });
}

/**
 * Turning a category on or off.
 *
 * Separate from the edit form because it is the answer to "delete one that has
 * services", and somebody reaching for it has already been told so — a
 * checkbox inside a form they have to remember to save would lose that.
 */
export async function setCategoryActiveAction(
  _previous: CategoryActionState,
  form: FormData,
): Promise<CategoryActionState> {
  const actor = await requireAdminActor();
  const ctx = createRequestContext();

  return run(async () => {
    const active = readString(form, "active") === "true";
    await updateCategory(ctx, actor, readString(form, "categoryId"), { active });
    // What is true today, not what the column is for. Nothing files a service
    // under a category yet — that is the vendor catalogue screen — so this
    // records the decision and says so rather than claiming an enforcement the
    // platform does not have.
    return active
      ? "Offered again."
      : "Deactivated. The listings already filed under it keep it. Nothing files new ones yet — the listing editor will honour this when it lands.";
  });
}

export async function moveCategoryAction(
  _previous: CategoryActionState,
  form: FormData,
): Promise<CategoryActionState> {
  const actor = await requireAdminActor();
  const ctx = createRequestContext();

  return run(async () => {
    const direction = readString(form, "direction") === "up" ? "up" : "down";
    await moveCategory(ctx, actor, readString(form, "categoryId"), direction);
    return "Moved.";
  });
}

export async function deleteCategoryAction(
  _previous: CategoryActionState,
  form: FormData,
): Promise<CategoryActionState> {
  const actor = await requireAdminActor();
  const ctx = createRequestContext();

  return run(async () => {
    await deleteCategory(ctx, actor, readString(form, "categoryId"));
    return "Deleted.";
  });
}
