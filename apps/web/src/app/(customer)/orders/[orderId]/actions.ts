"use server";

import { revalidatePath } from "next/cache";
import { AppError, refundWithinCoolingWindow } from "@occasion/core";
import { requireCustomerActor } from "../../../../lib/auth-guard";
import { createRequestContext } from "../../../../lib/core";
import { readString } from "../../../../lib/form-values";

/**
 * Cancelling one's own booking, inside the free window.
 *
 * `requireCustomerActor()` first, because an action is reachable by a direct
 * POST that renders no layout; `refundWithinCoolingWindow` then asserts the
 * order's own pay policy, so an id that is not the caller's is refused there
 * whatever this screen did.
 *
 * **It calls the function that already exists.** That one asserts the policy,
 * refuses a closed window with a message the screen shows, refunds every
 * settled charge, moves the order `cancelled` → `refunded` — which releases the
 * date, retires the emailed links and calls off the queued work — and writes
 * two audit entries. A customer-facing variant would be a second implementation
 * of all of it, and the day the two disagreed somebody would be refunded twice
 * or not at all.
 */

export type CancelState = {
  error?: string;
};

export async function cancelOwnBookingAction(
  _previous: CancelState,
  form: FormData,
): Promise<CancelState> {
  const actor = await requireCustomerActor();
  const ctx = createRequestContext();

  const orderId = readString(form, "orderId").trim();

  try {
    await refundWithinCoolingWindow(ctx, actor, orderId);
  } catch (error) {
    // A refusal is something the person can act on — the window has closed,
    // the deposit has already been paid out — and it is shown where they are
    // looking. Anything else is a fault and belongs to the error boundary.
    if (error instanceof AppError) return { error: error.message };
    throw error;
  }

  // The booking's own screen, the list it is on, and the planner whose slot it
  // just released.
  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/orders");
  revalidatePath("/events");

  return {};
}
