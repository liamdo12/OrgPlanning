"use server";

import { revalidatePath } from "next/cache";
import { AppError, decideReport } from "@occasion/core";
import { requireAdminActor } from "../../../../lib/auth-guard";
import { createRequestContext } from "../../../../lib/core";
import { readString } from "../../../../lib/form-values";

/**
 * The moderation queue's actions.
 *
 * `requireAdminActor()` as the first statement, because a server action is
 * reachable by a direct POST that renders no layout at all — and the domain
 * then checks again, because this file is not the only thing that will ever
 * call it.
 *
 * Reporting content is deliberately not here. It is a thing any signed-in
 * account may do and belongs with the screen the content is on, which is a
 * customer view that does not exist yet; an administrator records one from the
 * report that reached them, and `reportContent` is what that will call.
 */

export type ModerationActionState = {
  error?: string;
  message?: string;
};

export async function decideReportAction(
  _previous: ModerationActionState,
  form: FormData,
): Promise<ModerationActionState> {
  const actor = await requireAdminActor();
  const ctx = createRequestContext();

  try {
    const result = await decideReport(ctx, actor, readString(form, "reportId"), {
      decision: readString(form, "decision"),
      note: readString(form, "note"),
    });

    revalidatePath("/admin/moderation");

    // What happened to the words, not merely that a decision was taken. Only
    // `remove` destroys anything, and somebody pressing it should be told.
    const said =
      result.decision === "keep"
        ? "Left up."
        : result.decision === "hide"
          ? "Hidden. The words are still on the row, so this can be undone."
          : "Removed. The words are gone from the row; the audit entry keeps them.";

    return { message: said };
  } catch (error) {
    if (error instanceof AppError) {
      return { error: error.message };
    }
    throw error;
  }
}
