"use server";

import { revalidatePath } from "next/cache";
import {
  AppError,
  ValidationError,
  addDisputeNote,
  assignDispute,
  listOrdersForAdmin,
  openDispute,
  resolveDispute,
  startDisputeReview,
} from "@occasion/core";
import { requireAdminActor } from "../../../../lib/auth-guard";
import { createRequestContext } from "../../../../lib/core";
import { readString } from "../../../../lib/form-values";

/**
 * The complaints queue's actions.
 *
 * Every one calls `requireAdminActor()` as its first statement. The layout
 * above this screen redirects a non-admin, but a server action is reachable by
 * a direct POST that renders no layout at all, so the gate has to be in the
 * function that does the work — and the domain then checks again, because this
 * file is not the only thing that will ever call it.
 */

export type DisputeActionState = {
  error?: string;
  message?: string;
};

/**
 * Runs one decision and turns a domain refusal into something readable.
 *
 * Only `AppError` is caught. Anything else is a fault rather than a refusal and
 * belongs in the error boundary with a digest, not paraphrased into a toast
 * that says something reassuringly vague.
 */
async function run(work: () => Promise<string>): Promise<DisputeActionState> {
  try {
    const message = await work();
    revalidatePath("/admin/disputes");
    // The order's own screen shows the case's effect on it: closing one can
    // take a booking out of `issue`, and the orders list caches its rows.
    revalidatePath("/admin/orders");
    return { message };
  } catch (error) {
    if (error instanceof AppError) {
      return { error: error.message };
    }
    throw error;
  }
}

/**
 * Records a complaint that arrived by phone or email.
 *
 * The booking is named by its reference rather than its id, because that is
 * what the person on the phone can read out and what appears on their
 * confirmation. It is resolved through the orders list the administrator can
 * already see, so this adds no way to reach an order they could not.
 */
export async function openDisputeAction(
  _previous: DisputeActionState,
  form: FormData,
): Promise<DisputeActionState> {
  const actor = await requireAdminActor();
  const ctx = createRequestContext();

  return run(async () => {
    const reference = readString(form, "reference").trim().toUpperCase();
    if (!reference) {
      throw new ValidationError("Which booking is the complaint about?", {
        reference: "required",
      });
    }

    // Exact match only. The search is a prefix-and-contains query for a person
    // scanning a list; opening a case against "whichever order matched first"
    // is not the same kind of act.
    const found = await listOrdersForAdmin(ctx, actor, { search: reference });
    const order = found.rows.find((row) => row.reference.toUpperCase() === reference);
    if (!order) {
      throw new ValidationError(`No booking with the reference ${reference}.`, {
        reference: "unknown",
      });
    }

    await openDispute(ctx, actor, order.id, {
      reason: readString(form, "reason"),
      detail: readString(form, "detail"),
    });

    return `Case opened against ${order.reference}. It is in the queue and assigned to nobody.`;
  });
}

export async function addNoteAction(
  _previous: DisputeActionState,
  form: FormData,
): Promise<DisputeActionState> {
  const actor = await requireAdminActor();
  const ctx = createRequestContext();

  return run(async () => {
    await addDisputeNote(ctx, actor, readString(form, "disputeId"), readString(form, "body"));
    return "Note added. Internal only — nobody outside the platform sees it.";
  });
}

export async function assignDisputeAction(
  _previous: DisputeActionState,
  form: FormData,
): Promise<DisputeActionState> {
  const actor = await requireAdminActor();
  const ctx = createRequestContext();

  return run(async () => {
    // An empty field means "put it back in the unassigned pile", which is a
    // real thing to want and is why the domain takes `null` rather than
    // refusing a blank.
    const userId = readString(form, "userId").trim();
    await assignDispute(ctx, actor, readString(form, "disputeId"), userId || null);
    return userId ? "Assigned." : "Put back in the unassigned pile.";
  });
}

export async function startReviewAction(
  _previous: DisputeActionState,
  form: FormData,
): Promise<DisputeActionState> {
  const actor = await requireAdminActor();
  const ctx = createRequestContext();

  return run(async () => {
    await startDisputeReview(ctx, actor, readString(form, "disputeId"));
    return "Marked as under investigation.";
  });
}

export async function resolveDisputeAction(
  _previous: DisputeActionState,
  form: FormData,
): Promise<DisputeActionState> {
  const actor = await requireAdminActor();
  const ctx = createRequestContext();

  return run(async () => {
    const orderTo = readString(form, "orderTo").trim();

    const result = await resolveDispute(ctx, actor, readString(form, "disputeId"), {
      resolution: readString(form, "resolution"),
      note: readString(form, "note"),
      ...(orderTo ? { orderTo } : {}),
    });

    // The order half is said out loud. It is the part somebody will be asked
    // about later, and a message that only mentions the case would leave a
    // booking having quietly changed state.
    return result.orderState
      ? `Case closed, and the booking is ${result.orderState} again.`
      : "Case closed.";
  });
}
