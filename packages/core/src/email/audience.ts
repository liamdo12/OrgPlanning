import { ValidationError } from "../errors.js";
import type { CoreContext } from "../context.js";
import * as repo from "./repo.js";
import type { EmailTemplate } from "./template.js";

/**
 * Who a send actually reaches.
 *
 * The prototype offers three audiences and three scopes (lines 2678–2681) and
 * resolves neither — its counts are string literals. Here the count on screen
 * is the count that will be sent to, which is the only version of that number
 * worth showing an administrator immediately before they approve it.
 *
 * Three filters apply to every audience, and none of them is optional:
 *
 * - **Suspended accounts are excluded.** The platform has stopped doing
 *   business with them; continuing to mail them is the one thing a suspension
 *   should obviously stop.
 * - **Unverified addresses are excluded.** Nobody has shown the address belongs
 *   to the person who typed it, so mail to it is mail to a stranger.
 * - **A broadcast additionally requires express consent**, resolved per
 *   recipient against `communication_consents`. See `repo.resolveAudience`.
 */

/** The prototype's three buttons, line 2675. */
export type Audience = "customers" | "vendors" | "both";

/** The prototype's three recipient options, lines 2678–2680. */
export type Scope =
  | { kind: "everyone" }
  | { kind: "active_90_days" }
  | { kind: "accounts"; userIds: readonly string[] };

export const ACTIVE_WINDOW_DAYS = 90;

export function parseAudience(value: unknown): Audience {
  if (value === "customers" || value === "vendors" || value === "both") return value;
  throw new ValidationError("Pick customers, vendors or both.", { audience: "invalid" });
}

export function audienceLabel(value: Audience): string {
  switch (value) {
    case "customers":
      return "Customers";
    case "vendors":
      return "Vendors";
    case "both":
      return "Both";
  }
}

function rolesFor(value: Audience): readonly ("customer" | "vendor")[] {
  switch (value) {
    case "customers":
      return ["customer"];
    case "vendors":
      return ["vendor"];
    case "both":
      return ["customer", "vendor"];
  }
}

export type Recipient = repo.RecipientRow;

/**
 * The addresses a send would go to, in full.
 *
 * Returns the list rather than a count, because the caller needs both and
 * asking twice is how the number in the dialog stops being the number that is
 * sent to. The two must come from one query.
 */
export async function resolveRecipients(
  ctx: CoreContext,
  input: { audience: Audience; scope: Scope; template: EmailTemplate },
): Promise<Recipient[]> {
  const now = ctx.clock.realNow();

  return repo.resolveAudience(ctx.db, {
    roles: rolesFor(input.audience),
    activeSince:
      input.scope.kind === "active_90_days"
        ? new Date(now.getTime() - ACTIVE_WINDOW_DAYS * 86_400_000)
        : null,
    userIds: input.scope.kind === "accounts" ? input.scope.userIds : null,
    // Only marketing needs consent. Operational mail to a business about its
    // own payout is not a commercial electronic message in the sense that
    // requires one, and requiring it here would mean a vendor could not be told
    // their money had moved.
    requireConsent: input.template.class === "broadcast",
    // The real clock, not the domain clock. Consent expiry is a legal fact
    // about a date somebody agreed on, and an admin demo override moving it
    // would make expired consent look live.
    now,
  });
}

/**
 * How the screen describes a scope before anything is sent.
 *
 * The count is passed in rather than recomputed, so the sentence and the send
 * cannot disagree.
 */
export function describeScope(audience: Audience, scope: Scope, count: number): string {
  const accounts = `${count.toLocaleString("en-CA")} account${count === 1 ? "" : "s"}`;

  switch (scope.kind) {
    case "everyone":
      return audience === "both"
        ? `Everyone · ${accounts}`
        : `All ${audienceLabel(audience).toLowerCase()} · ${accounts}`;
    case "active_90_days":
      return `Active in ${ACTIVE_WINDOW_DAYS} days · ${accounts}`;
    case "accounts":
      return `Selected accounts · ${accounts}`;
  }
}
