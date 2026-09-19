import { ValidationError } from "../errors.js";

/**
 * What can be reported, and what each decision does to it.
 *
 * The three kinds of text one person writes that another person reads: a
 * review, a message in a thread, and the line a business writes about itself.
 *
 * The decision vocabulary is `keep | hide | remove`, and what those words can
 * mean depends on what the content is. A review and a message are rows with a
 * moderation state, so hiding is reversible and removal is not. A vendor's
 * profile line is a single column on the business's own record: there is
 * nowhere to hide it to, so the queue offers `keep` and `remove` and does not
 * pretend otherwise. That is the rule the screen renders from, rather than
 * showing a button that quietly does the same thing as the one beside it.
 */

export const CONTENT_TARGETS = ["review", "message", "vendor_profile"] as const;
export type ContentTarget = (typeof CONTENT_TARGETS)[number];

export const CONTENT_DECISIONS = ["keep", "hide", "remove"] as const;
export type ContentDecision = (typeof CONTENT_DECISIONS)[number];

/**
 * What replaces the words when a decision is `remove`.
 *
 * A marker rather than an empty column. `null` on a review body is a rating
 * with no words, which is an ordinary thing for a customer to leave — so
 * blanking it would make a removal indistinguishable from a review nobody
 * bothered to write. The row stays either way: the report, the decision and
 * the audit entry are the record that there was something here.
 */
export const REMOVED_TEXT = "[removed by a moderator]";

export function decisionsFor(target: ContentTarget): readonly ContentDecision[] {
  return target === "vendor_profile" ? ["keep", "remove"] : CONTENT_DECISIONS;
}

export function assertDecisionAllowed(target: ContentTarget, decision: ContentDecision): void {
  if (!decisionsFor(target).includes(decision)) {
    throw new ValidationError(
      decision === "hide"
        ? "A profile line has nowhere to be hidden to. Keep it or remove it."
        : `${decision} is not a decision for ${targetLabel(target)}.`,
      { decision: "not_applicable" },
    );
  }
}

export function parseContentTarget(value: string): ContentTarget {
  const found = CONTENT_TARGETS.find((target) => target === value);
  if (!found) {
    throw new ValidationError(`${value} is not something that can be reported.`, {
      targetType: "unknown",
    });
  }
  return found;
}

export function parseContentDecision(value: string): ContentDecision {
  const found = CONTENT_DECISIONS.find((decision) => decision === value);
  if (!found) throw new ValidationError(`${value} is not a decision.`, { decision: "unknown" });
  return found;
}

export function targetLabel(target: ContentTarget): string {
  switch (target) {
    case "review":
      return "a review";
    case "message":
      return "a message";
    case "vendor_profile":
      return "a business profile";
  }
}

export function decisionLabel(decision: ContentDecision): string {
  switch (decision) {
    case "keep":
      return "Kept";
    case "hide":
      return "Hidden";
    case "remove":
      return "Removed";
  }
}
