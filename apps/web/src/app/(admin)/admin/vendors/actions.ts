"use server";

import { revalidatePath } from "next/cache";
import {
  AppError,
  approveVendor,
  blockVendor,
  markUnderReview,
  reinstateVendor,
  suspendVendor,
  type StatusChange,
} from "@occasion/core";
import { requireAdminActor } from "../../../../lib/auth-guard";
import { createRequestContext } from "../../../../lib/core";
import { readString } from "../../../../lib/form-values";
import { summarise } from "./_components/change-summary";

/**
 * The vendor queue's actions.
 *
 * Every one calls `requireAdminActor()` as its first statement. The layout
 * above this screen redirects a non-admin, but a server action is reachable by
 * a direct POST that renders no layout at all, so the gate has to be in the
 * function that does the work — and the domain then checks again, because this
 * file is not the only thing that will ever call it.
 */

export type VendorActionState = {
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
async function run(work: () => Promise<StatusChange>): Promise<VendorActionState> {
  try {
    const change = await work();
    // The list, the row and the drawer all read the same rows.
    revalidatePath("/admin/vendors");
    return { message: summarise(change) };
  } catch (error) {
    if (error instanceof AppError) {
      return { error: error.message };
    }
    throw error;
  }
}

export async function approveVendorAction(
  _previous: VendorActionState,
  form: FormData,
): Promise<VendorActionState> {
  const actor = await requireAdminActor();
  const ctx = createRequestContext();
  const vendorId = readString(form, "vendorId");

  return run(() => approveVendor(ctx, actor, vendorId));
}

export async function reinstateVendorAction(
  _previous: VendorActionState,
  form: FormData,
): Promise<VendorActionState> {
  const actor = await requireAdminActor();
  const ctx = createRequestContext();
  const vendorId = readString(form, "vendorId");

  return run(() => reinstateVendor(ctx, actor, vendorId));
}

export async function suspendVendorAction(
  _previous: VendorActionState,
  form: FormData,
): Promise<VendorActionState> {
  const actor = await requireAdminActor();
  const ctx = createRequestContext();
  const vendorId = readString(form, "vendorId");
  const reason = readString(form, "reason");

  return run(() => suspendVendor(ctx, actor, vendorId, reason));
}

export async function blockVendorAction(
  _previous: VendorActionState,
  form: FormData,
): Promise<VendorActionState> {
  const actor = await requireAdminActor();
  const ctx = createRequestContext();
  const vendorId = readString(form, "vendorId");
  const reason = readString(form, "reason");

  return run(() => blockVendor(ctx, actor, vendorId, reason));
}

export async function markUnderReviewAction(
  _previous: VendorActionState,
  form: FormData,
): Promise<VendorActionState> {
  const actor = await requireAdminActor();
  const ctx = createRequestContext();
  const vendorId = readString(form, "vendorId");

  return run(() => markUnderReview(ctx, actor, vendorId));
}
