import { record } from "../audit/service.js";
import type { CoreContext } from "../context.js";
import { NotFoundError, UnauthenticatedError, ValidationError } from "../errors.js";
import { isAuthenticated, isUsable, type Actor } from "../identity/actor.js";
import { requireAdmin } from "../identity/service.js";
import * as repo from "./repo.js";
import {
  assertDecisionAllowed,
  decisionLabel,
  decisionsFor,
  parseContentDecision,
  parseContentTarget,
  targetLabel,
  type ContentDecision,
} from "./targets.js";

/**
 * Reported content, and what an administrator decides about it.
 *
 * The queue is administrative: a report is about the platform's own content
 * rather than about a relationship between two parties, so `requireAdmin()` is
 * the whole authorization story for everything that reads or decides.
 *
 * Filing one is the exception. That is a thing any signed-in account may do —
 * it is how content gets reported at all — and it is guarded by being
 * authenticated and usable rather than by a role, with the database refusing a
 * second open report from the same person about the same thing.
 */

export type ReportSummary = repo.ReportRow & {
  content: repo.TargetContent;
  /** What may be decided about this kind of content. */
  choices: readonly ContentDecision[];
  decisionLabel: string | null;
  targetLabel: string;
  open: boolean;
};

export type ReportList = {
  rows: ReportSummary[];
  open: number;
  total: number;
};

export type ReportFilter = repo.ReportFilter;

/** The queue, with the reported words attached. */
export async function listReports(
  ctx: CoreContext,
  actor: Actor,
  filter: ReportFilter = {},
): Promise<ReportList> {
  requireAdmin(actor);

  const [rows, open] = await Promise.all([
    repo.listReports(ctx.db, filter),
    repo.countOpen(ctx.db),
  ]);

  const targets = await repo.loadTargets(ctx.db, rows);

  return {
    rows: rows.map((row) => summarise(row, targets)),
    open,
    total: rows.length,
  };
}

function summarise(
  row: repo.ReportRow,
  targets: Map<string, repo.TargetContent>,
): ReportSummary {
  const content = targets.get(`${row.targetType}:${row.targetId}`) as repo.TargetContent;

  return {
    ...row,
    content,
    choices: decisionsFor(row.targetType),
    decisionLabel: row.decision ? decisionLabel(row.decision) : null,
    targetLabel: targetLabel(row.targetType),
    open: row.decidedAt === null,
  };
}

export type ReportDetail = {
  report: ReportSummary;
  /** Everything else anybody has said about the same content. */
  history: repo.ReportRow[];
};

export async function getReport(
  ctx: CoreContext,
  actor: Actor,
  reportId: string,
): Promise<ReportDetail> {
  requireAdmin(actor);

  const row = await repo.load(ctx.db, reportId);
  if (!row) throw new NotFoundError("No such report.");

  const targets = await repo.loadTargets(ctx.db, [row]);
  const history = await repo.listForTarget(ctx.db, row.targetType, row.targetId);

  return {
    report: summarise(row, targets),
    history: history.filter((entry) => entry.id !== row.id),
  };
}

/**
 * Files a report.
 *
 * Any signed-in account in good standing, because reporting is how content
 * reaches the queue in the first place — an administrator records one that
 * arrived by email, and the customer views will call the same function.
 *
 * The one-open-report-per-person rule is the database's, not this function's:
 * reading first and inserting second lets two submissions of the same form both
 * find nothing and both insert, which is the ordinary way a double-click
 * produces a duplicate.
 */
export async function reportContent(
  ctx: CoreContext,
  actor: Actor,
  input: {
    /** Parsed here, so a form value and a typed caller take the same path. */
    targetType: string;
    targetId: string;
    reason: string;
    detail?: string | undefined;
  },
): Promise<string> {
  if (!isAuthenticated(actor)) throw new UnauthenticatedError();
  if (!isUsable(actor)) {
    // A suspended account's report would be a queue entry nobody can follow up
    // with, and the refusal is the same one every other guard gives.
    throw new NotFoundError("No such content.");
  }

  const targetType = parseContentTarget(input.targetType);
  const reason = input.reason.trim();
  if (!reason) {
    throw new ValidationError("Say what is wrong with it.", { reason: "required" });
  }

  const targets = await repo.loadTargets(ctx.db, [{ targetType, targetId: input.targetId }]);
  const content = targets.get(`${targetType}:${input.targetId}`);
  if (!content?.present) throw new NotFoundError("No such content.");

  const now = ctx.clock.now();

  return ctx.db.transaction(async (tx) => {
    const reportId = await repo.insertReport(tx, {
      targetType,
      targetId: input.targetId,
      reporterUserId: actor.userId,
      reason: reason.slice(0, 200),
      detail: input.detail?.trim().slice(0, 2000) ?? null,
      now,
    });

    await record(
      ctx,
      actor,
      {
        action: "moderation.report",
        entityType: "content_report",
        entityId: reportId,
        after: { targetType, targetId: input.targetId, reason: reason.slice(0, 200) },
      },
      tx,
    );

    return reportId;
  });
}

export type DecideResult = {
  decision: ContentDecision;
  /** Whether the words themselves changed. */
  contentChanged: boolean;
};

/**
 * Decides a report, and applies the decision to the content.
 *
 * One transaction, because the two halves are the same act. A report marked
 * `remove` whose review is still readable is worse than an undecided one: the
 * queue says it was dealt with, so nobody looks again.
 *
 * The words that were taken down go on the audit entry. They are about to stop
 * existing on the row they were written to, and "a review was removed" answers
 * nothing when the person who wrote it asks why.
 */
export async function decideReport(
  ctx: CoreContext,
  actor: Actor,
  reportId: string,
  input: { decision: string; note?: string | undefined },
): Promise<DecideResult> {
  requireAdmin(actor);

  const decision = parseContentDecision(input.decision);
  const now = ctx.clock.now();

  return ctx.db.transaction(async (tx) => {
    const report = await repo.loadForUpdate(tx, reportId);
    if (!report) throw new NotFoundError("No such report.");

    if (report.decidedAt !== null) {
      throw new ValidationError("That report has already been decided.", {
        report: "already_decided",
      });
    }

    assertDecisionAllowed(report.targetType, decision);

    const applied = await repo.applyDecision(tx, {
      targetType: report.targetType,
      targetId: report.targetId,
      decision,
      moderatorUserId: isAuthenticated(actor) ? actor.userId : null,
      now,
    });

    await repo.setDecision(tx, reportId, {
      decision,
      note: input.note?.trim().slice(0, 2000) ?? null,
      decidedByUserId: isAuthenticated(actor) ? actor.userId : null,
      now,
    });

    await record(
      ctx,
      actor,
      {
        action: "moderation.decide",
        entityType: "content_report",
        entityId: reportId,
        before: { decision: null, body: applied.before },
        after: {
          decision,
          targetType: report.targetType,
          targetId: report.targetId,
          body: applied.after,
          note: input.note?.trim().slice(0, 2000) ?? null,
        },
      },
      tx,
    );

    return { decision, contentChanged: applied.before !== applied.after };
  });
}
