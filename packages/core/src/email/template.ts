import { ValidationError } from "../errors.js";

/**
 * What a template is, before anybody edits it.
 *
 * Every template ships as a module in `templates/`, and `email_templates` holds
 * only what an administrator has since changed. Two reasons for that shape
 * rather than seeding rows:
 *
 * - A transactional message is part of the lifecycle, so a deployment with an
 *   empty database still sends a correct confirmation. A seeded row is data
 *   somebody can delete, and deleting it would silently stop the emails an
 *   order depends on.
 * - The allowlist and the class are load-bearing security properties. Holding
 *   the defaults in code puts them in the diff, where a change to them is
 *   reviewed like any other change to a rule.
 */

export type TemplateClass = "automatic" | "vendors" | "broadcast";

export type TemplateAudience = "customers" | "vendors" | "admins" | "all";

export type EmailTemplate = {
  /** Stable across edits; what a job payload names and what a row joins on. */
  readonly key: string;
  readonly name: string;
  readonly audience: TemplateAudience;
  readonly class: TemplateClass;
  /** The prototype's one-line explanation of what causes it to send. */
  readonly trigger: string;
  /** Whether the lifecycle sends it unasked, before an administrator says otherwise. */
  readonly autoSend: boolean;
  readonly subject: string;
  readonly body: string;
  readonly allowedFields: readonly string[];
};

export const TEMPLATE_CLASSES: readonly TemplateClass[] = ["automatic", "vendors", "broadcast"];

/** The tag the prototype puts on a template card (line 2716). */
export function classLabel(value: TemplateClass): string {
  switch (value) {
    case "automatic":
      return "Automatic";
    case "vendors":
      return "Vendors";
    case "broadcast":
      return "Broadcast";
  }
}

export function parseTemplateClass(value: unknown): TemplateClass {
  if (value === "automatic" || value === "vendors" || value === "broadcast") return value;
  throw new ValidationError("That is not a template class.", { class: "invalid" });
}

export function parseTemplateAudience(value: unknown): TemplateAudience {
  if (value === "customers" || value === "vendors" || value === "admins" || value === "all") {
    return value;
  }
  throw new ValidationError("That is not an audience.", { audience: "invalid" });
}
