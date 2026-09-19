"use server";

import { revalidatePath } from "next/cache";
import {
  AppError,
  parseAudience,
  parseFieldName,
  saveTemplate,
  sendBroadcast,
  sendTest,
  setAutoSend,
  ValidationError,
  type Scope,
} from "@occasion/core";
import { requireAdminActor } from "../../../../lib/auth-guard";
import { createRequestContext } from "../../../../lib/core";
import { readString } from "../../../../lib/form-values";

/**
 * The email screen's actions.
 *
 * Each calls `requireAdminActor()` as its first statement. A server action is
 * reachable by a direct POST that renders no layout, so the layout's redirect
 * is not a guard — and the thing behind these is a button that mails eleven
 * hundred people.
 *
 * Every refusal the domain makes is returned as a message rather than thrown,
 * because all of them are things the administrator can act on: a field that is
 * not allowed, a count that has moved, a confirmation not yet given.
 */

export type EmailActionState = {
  error?: string;
  message?: string;
  /** Set when the domain wants the larger confirmation before it will send. */
  confirmCount?: number;
};

async function run(work: () => Promise<EmailActionState>): Promise<EmailActionState> {
  try {
    const state = await work();
    revalidatePath("/admin/email");
    return state;
  } catch (error) {
    if (error instanceof AppError) {
      return { error: error.message };
    }
    throw error;
  }
}

export async function saveTemplateAction(
  _previous: EmailActionState,
  form: FormData,
): Promise<EmailActionState> {
  const actor = await requireAdminActor();
  const ctx = createRequestContext();

  return run(async () => {
    // The chips the author left ticked. Narrowed here as well as in the domain:
    // `parseFieldName` refuses anything that is not a field this platform
    // knows, so a hand-crafted POST cannot write an allowlist entry that no
    // send can ever satisfy.
    const allowedFields = form.getAll("field").map(parseFieldName);

    const saved = await saveTemplate(ctx, actor, {
      key: readString(form, "key"),
      name: readString(form, "name"),
      trigger: readString(form, "trigger") || null,
      // Carried on the form so that saving a typo does not also turn a
      // lifecycle message off. It was absent once, and the effect was silent:
      // `saveTemplate` wrote the column null, `queueTransactional` read it back
      // as false, and every booking confirmation from then on was skipped with
      // nothing logged and nothing on screen to say so.
      autoSend: readString(form, "autoSend") === "on",
      subject: readString(form, "subject"),
      body: readString(form, "body"),
      allowedFields,
    });

    return { message: `Saved “${saved.name}”.` };
  });
}

export async function setAutoSendAction(
  _previous: EmailActionState,
  form: FormData,
): Promise<EmailActionState> {
  const actor = await requireAdminActor();
  const ctx = createRequestContext();

  return run(async () => {
    const on = readString(form, "autoSend") === "on";
    const saved = await setAutoSend(ctx, actor, readString(form, "key"), on);

    return {
      message: on
        ? `“${saved.name}” will send automatically.`
        : `“${saved.name}” will no longer send automatically. It can still be sent by hand.`,
    };
  });
}

export async function sendTestAction(
  _previous: EmailActionState,
  form: FormData,
): Promise<EmailActionState> {
  const actor = await requireAdminActor();
  const ctx = createRequestContext();

  return run(async () => {
    const sent = await sendTest(ctx, actor, readString(form, "key"));
    return { message: `Sent to ${sent.to}, with the sample values filled in.` };
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function scopeFrom(form: FormData): Scope {
  const kind = readString(form, "scope");

  if (kind === "active_90_days") return { kind: "active_90_days" };
  if (kind === "accounts") {
    // Narrowed here because the column is `uuid`: anything else makes Postgres
    // raise `22P02`, which is not an `AppError`, so it would escape `run` as an
    // unhandled 500 rather than a sentence the administrator can act on.
    const userIds = form.getAll("userId").map(String);
    for (const id of userIds) {
      if (!UUID.test(id))
        throw new ValidationError("That is not an account.", { userId: "invalid" });
    }
    return { kind: "accounts", userIds };
  }
  return { kind: "everyone" };
}

export async function sendBroadcastAction(
  _previous: EmailActionState,
  form: FormData,
): Promise<EmailActionState> {
  const actor = await requireAdminActor();
  const ctx = createRequestContext();

  return run(async () => {
    const expectedCount = Number(readString(form, "expectedCount"));
    if (!Number.isInteger(expectedCount) || expectedCount < 0) {
      return { error: "That is not a recipient count." };
    }

    // The fields the platform cannot fill in — a policy's effective date, the
    // URL it is published at. Posted as `value_<field>` so the form carries
    // them without a second parser.
    const values: Record<string, string> = {};
    for (const [key, value] of form.entries()) {
      if (key.startsWith("value_") && typeof value === "string") {
        values[parseFieldName(key.slice("value_".length))] = value;
      }
    }

    const result = await sendBroadcast(ctx, actor, {
      templateKey: readString(form, "key"),
      audience: parseAudience(readString(form, "audience")),
      scope: scopeFrom(form),
      // The number the administrator was shown. The domain compares it against
      // the audience as it stands now and refuses a mismatch, so the dialog's
      // count is the count that is sent to rather than a decoration.
      expectedCount,
      confirmedLarge: readString(form, "confirmedLarge") === "on",
      values,
    });

    return {
      message: `Queued to ${result.description}. “${result.subject}” is on its way.`,
    };
  });
}
