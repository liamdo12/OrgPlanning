"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  Dialog,
  Input,
  ListRow,
  ListStack,
  StatusBadge,
  Toast,
  ToastRegion,
} from "@occasion/ui";
import type { AdminCategory } from "@occasion/core";
import {
  createCategoryAction,
  deleteCategoryAction,
  moveCategoryAction,
  setCategoryActiveAction,
  updateCategoryAction,
  type CategoryActionState,
} from "../actions";

/**
 * The category list, and everything done to it.
 *
 * One client component rather than five, because every control here reports
 * into the same place: the delete that is refused, the deactivation that
 * explains itself, the move that renumbers the list. Splitting them would mean
 * five toast regions stacked on top of each other.
 *
 * Reordering is buttons, not dragging. It is the non-drag alternative the plan
 * asks for and the only one that works from a keyboard without a bespoke
 * implementation of drag-and-drop semantics nobody would test.
 */

const INITIAL: CategoryActionState = {};

export function CategoryList({ categories }: { categories: readonly AdminCategory[] }) {
  const router = useRouter();
  const [reported, setReported] = useState<CategoryActionState | null>(null);
  const [editing, setEditing] = useState<AdminCategory | null>(null);
  const [adding, setAdding] = useState(false);

  function report(result: CategoryActionState): CategoryActionState {
    setReported(result);
    // The action revalidates the path; this is what makes the open page re-read
    // it without a full navigation.
    if (!result.error) router.refresh();
    return result;
  }

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button intent="primary" size="sm" onClick={() => setAdding(true)}>
          Add a category
        </Button>
      </div>

      <ListStack as="ul" className="list-none p-0">
        {categories.map((category, index) => (
          <li key={category.id}>
            <ListRow
              leading={
                <span
                  aria-hidden="true"
                  className="block size-[34px] flex-none rounded-[13px]"
                  style={{ background: category.tone ?? "var(--color-hairline)" }}
                />
              }
              title={category.name}
              subtitle={`${category.slug} · ${category.inUseBy ?? "nothing filed under it"}`}
              trailing={
                <div className="flex flex-wrap items-center gap-2">
                  {category.active ? null : <StatusBadge tone="neutral">Not offered</StatusBadge>}

                  <MoveButton
                    categoryId={category.id}
                    direction="up"
                    disabled={index === 0}
                    onDone={report}
                  />
                  <MoveButton
                    categoryId={category.id}
                    direction="down"
                    disabled={index === categories.length - 1}
                    onDone={report}
                  />

                  <Button intent="ghost" size="sm" onClick={() => setEditing(category)}>
                    Edit
                  </Button>

                  <ActiveButton category={category} onDone={report} />
                  <DeleteButton category={category} onDone={report} />
                </div>
              }
            />
          </li>
        ))}
      </ListStack>

      <Dialog open={adding} onClose={() => setAdding(false)} title="Add a category">
        <CategoryForm
          action={createCategoryAction}
          submitLabel="Add"
          onDone={(result) => {
            if (!report(result).error) setAdding(false);
          }}
        />
      </Dialog>

      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing ? `Edit ${editing.name}` : ""}
      >
        {editing ? (
          <CategoryForm
            action={updateCategoryAction}
            submitLabel="Save"
            category={editing}
            onDone={(result) => {
              if (!report(result).error) setEditing(null);
            }}
          />
        ) : null}
      </Dialog>

      {reported?.error || reported?.message ? (
        <ToastRegion>
          <Toast tone={reported.error ? "danger" : "success"} onDismiss={() => setReported(null)}>
            {reported.error ?? reported.message}
          </Toast>
        </ToastRegion>
      ) : null}
    </>
  );
}

type Reporter = (result: CategoryActionState) => CategoryActionState;

function MoveButton({
  categoryId,
  direction,
  disabled,
  onDone,
}: {
  categoryId: string;
  direction: "up" | "down";
  disabled: boolean;
  onDone: Reporter;
}) {
  const [, submit, pending] = useActionState(
    async (previous: CategoryActionState, form: FormData) =>
      onDone(await moveCategoryAction(previous, form)),
    INITIAL,
  );

  return (
    <form action={submit}>
      <input type="hidden" name="categoryId" value={categoryId} />
      <input type="hidden" name="direction" value={direction} />
      <Button
        type="submit"
        intent="ghost"
        size="sm"
        disabled={disabled || pending}
        // The arrow alone is not a name, and the label repeats down the list.
        aria-label={`Move ${direction}`}
      >
        {direction === "up" ? "↑" : "↓"}
      </Button>
    </form>
  );
}

function ActiveButton({ category, onDone }: { category: AdminCategory; onDone: Reporter }) {
  const [, submit, pending] = useActionState(
    async (previous: CategoryActionState, form: FormData) =>
      onDone(await setCategoryActiveAction(previous, form)),
    INITIAL,
  );

  return (
    <form action={submit}>
      <input type="hidden" name="categoryId" value={category.id} />
      <input type="hidden" name="active" value={category.active ? "false" : "true"} />
      <Button
        type="submit"
        intent="ghost"
        size="sm"
        disabled={pending}
        aria-label={`${category.active ? "Deactivate" : "Offer"} ${category.name}`}
      >
        {category.active ? "Deactivate" : "Offer again"}
      </Button>
    </form>
  );
}

/**
 * Deleting one.
 *
 * Offered only when nothing is filed under it. The domain refuses the rest and
 * says what to do instead, but a button that is always refused is a button that
 * teaches people to ignore what it says.
 */
function DeleteButton({ category, onDone }: { category: AdminCategory; onDone: Reporter }) {
  const [asking, setAsking] = useState(false);
  const [, submit, pending] = useActionState(
    async (previous: CategoryActionState, form: FormData) => {
      const result = onDone(await deleteCategoryAction(previous, form));
      if (!result.error) setAsking(false);
      return result;
    },
    INITIAL,
  );

  if (!category.deletable) return null;

  return (
    <>
      <Button
        intent="danger"
        size="sm"
        onClick={() => setAsking(true)}
        aria-label={`Delete ${category.name}`}
      >
        Delete
      </Button>

      <Dialog open={asking} onClose={() => setAsking(false)} title={`Delete ${category.name}?`}>
        <form action={submit} className="grid gap-3">
          <input type="hidden" name="categoryId" value={category.id} />
          <p className="m-0 text-sm">
            Nothing is filed under it, so nothing else changes. This cannot be undone.
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" intent="ghost" onClick={() => setAsking(false)}>
              Keep it
            </Button>
            <Button type="submit" intent="danger" disabled={pending}>
              {pending ? "Deleting…" : "Delete"}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

/**
 * The fields, shared by adding and editing.
 *
 * The tone is a CSS background rather than an icon because that is what the
 * prototype draws a category as (`cats()`, lines 1967–1973) — a gradient tile
 * with no glyph on it.
 */
function CategoryForm({
  action,
  submitLabel,
  category,
  onDone,
}: {
  action: (state: CategoryActionState, form: FormData) => Promise<CategoryActionState>;
  submitLabel: string;
  category?: AdminCategory;
  onDone: (result: CategoryActionState) => void;
}) {
  const [state, submit, pending] = useActionState(
    async (previous: CategoryActionState, form: FormData) => {
      const result = await action(previous, form);
      onDone(result);
      return result;
    },
    INITIAL,
  );

  return (
    <form action={submit} className="grid gap-3">
      {category ? <input type="hidden" name="categoryId" value={category.id} /> : null}

      <Input
        id="category-name"
        name="name"
        label="Name"
        defaultValue={category?.name ?? ""}
        required
        {...(state.error ? { error: state.error } : {})}
      />
      <Input
        id="category-slug"
        name="slug"
        label="Slug"
        hint="Left blank on a new category, this is derived from the name."
        defaultValue={category?.slug ?? ""}
      />
      <Input
        id="category-tone"
        name="tone"
        label="Tile colour"
        hint="Any CSS background. The seeded ones are the prototype's gradients."
        placeholder="linear-gradient(140deg, #EADFD1, #D6BFA8)"
        defaultValue={category?.tone ?? ""}
      />

      <div className="flex justify-end">
        <Button type="submit" intent="primary" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
