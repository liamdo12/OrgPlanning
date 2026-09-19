import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { contentReports, messages, reviews, users, vendors } from "@occasion/db/schema";
import type { DbExecutor } from "../context.js";
import { REMOVED_TEXT, type ContentDecision, type ContentTarget } from "./targets.js";

/**
 * Database access for the moderation queue.
 *
 * The target is polymorphic — one uuid column naming a row in one of three
 * tables — so reading it is three queries rather than a join, batched by kind
 * across the whole page. A per-row lookup would be the N+1 the render budget
 * forbids, and a join is not available: there is no column to join on.
 */

export type ReportRow = {
  id: string;
  targetType: ContentTarget;
  targetId: string;
  reporterUserId: string | null;
  reporterName: string | null;
  reason: string;
  detail: string | null;
  decision: ContentDecision | null;
  decidedByUserId: string | null;
  decidedByName: string | null;
  decidedAt: Date | null;
  decisionNote: string | null;
  createdAt: Date;
};

const reporters = users;

export type ReportFilter = {
  /** Only what nobody has decided yet. */
  open?: boolean | undefined;
  targetType?: ContentTarget | undefined;
};

export async function listReports(
  db: DbExecutor,
  filter: ReportFilter = {},
): Promise<ReportRow[]> {
  const conditions = [
    ...(filter.open ? [isNull(contentReports.decidedAt)] : []),
    ...(filter.targetType ? [eq(contentReports.targetType, filter.targetType)] : []),
  ];

  const rows = await db
    .select({
      id: contentReports.id,
      targetType: contentReports.targetType,
      targetId: contentReports.targetId,
      reporterUserId: contentReports.reporterUserId,
      reporterName: reporters.fullName,
      reason: contentReports.reason,
      detail: contentReports.detail,
      decision: contentReports.decision,
      decidedByUserId: contentReports.decidedByUserId,
      decidedAt: contentReports.decidedAt,
      decisionNote: contentReports.decisionNote,
      createdAt: contentReports.createdAt,
    })
    .from(contentReports)
    .leftJoin(reporters, eq(reporters.id, contentReports.reporterUserId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    // Undecided first and oldest first inside that: a queue is worked from the
    // front, and something reported a week ago and still up is the problem.
    .orderBy(asc(sql`${contentReports.decidedAt} is not null`), asc(contentReports.createdAt));

  return withDeciders(db, rows as ReportRow[]);
}

export async function countOpen(db: DbExecutor): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(contentReports)
    .where(isNull(contentReports.decidedAt));

  return row?.total ?? 0;
}

export async function load(db: DbExecutor, reportId: string): Promise<ReportRow | undefined> {
  const rows = await db
    .select({
      id: contentReports.id,
      targetType: contentReports.targetType,
      targetId: contentReports.targetId,
      reporterUserId: contentReports.reporterUserId,
      reporterName: reporters.fullName,
      reason: contentReports.reason,
      detail: contentReports.detail,
      decision: contentReports.decision,
      decidedByUserId: contentReports.decidedByUserId,
      decidedAt: contentReports.decidedAt,
      decisionNote: contentReports.decisionNote,
      createdAt: contentReports.createdAt,
    })
    .from(contentReports)
    .leftJoin(reporters, eq(reporters.id, contentReports.reporterUserId))
    .where(eq(contentReports.id, reportId))
    .limit(1);

  const [row] = await withDeciders(db, rows as ReportRow[]);
  return row;
}

export async function loadForUpdate(
  db: DbExecutor,
  reportId: string,
): Promise<
  | {
      id: string;
      targetType: ContentTarget;
      targetId: string;
      decision: ContentDecision | null;
      decidedAt: Date | null;
    }
  | undefined
> {
  const [row] = await db
    .select({
      id: contentReports.id,
      targetType: contentReports.targetType,
      targetId: contentReports.targetId,
      decision: contentReports.decision,
      decidedAt: contentReports.decidedAt,
    })
    .from(contentReports)
    .where(eq(contentReports.id, reportId))
    .for("update")
    .limit(1);

  return row;
}

async function withDeciders(db: DbExecutor, rows: ReportRow[]): Promise<ReportRow[]> {
  const ids = [...new Set(rows.flatMap((row) => (row.decidedByUserId ? [row.decidedByUserId] : [])))];
  if (ids.length === 0) return rows.map((row) => ({ ...row, decidedByName: null }));

  const found = await db
    .select({ id: users.id, fullName: users.fullName })
    .from(users)
    .where(inArray(users.id, ids));

  const names = new Map(found.map((row) => [row.id, row.fullName]));
  return rows.map((row) => ({
    ...row,
    decidedByName: row.decidedByUserId ? (names.get(row.decidedByUserId) ?? null) : null,
  }));
}

export async function insertReport(
  db: DbExecutor,
  input: {
    targetType: ContentTarget;
    targetId: string;
    reporterUserId: string | null;
    reason: string;
    detail: string | null;
    now: Date;
  },
): Promise<string> {
  const [row] = await db
    .insert(contentReports)
    .values({
      targetType: input.targetType,
      targetId: input.targetId,
      reporterUserId: input.reporterUserId,
      reason: input.reason,
      detail: input.detail,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .returning({ id: contentReports.id });

  return row?.id as string;
}

export async function setDecision(
  db: DbExecutor,
  reportId: string,
  input: {
    decision: ContentDecision;
    note: string | null;
    decidedByUserId: string | null;
    now: Date;
  },
): Promise<void> {
  await db
    .update(contentReports)
    .set({
      decision: input.decision,
      decisionNote: input.note,
      decidedByUserId: input.decidedByUserId,
      decidedAt: input.now,
      updatedAt: input.now,
    })
    .where(eq(contentReports.id, reportId));
}

/** What a report is about: the words themselves, and who wrote them. */
export type TargetContent = {
  targetType: ContentTarget;
  targetId: string;
  /** Null when the row has been deleted since the report was filed. */
  body: string | null;
  authorName: string | null;
  /** `approved` unless a moderator has acted. Absent for a profile line. */
  moderation: "pending" | "approved" | "rejected" | null;
  /** Where the content lives, for the link on the row. */
  context: string;
  /** Whether the row still exists. */
  present: boolean;
};

/**
 * The reported content, in one query per kind.
 *
 * Batched across the page rather than fetched per row: three round trips for a
 * hundred reports, not a hundred.
 */
export async function loadTargets(
  db: DbExecutor,
  rows: readonly { targetType: ContentTarget; targetId: string }[],
): Promise<Map<string, TargetContent>> {
  const byKind = new Map<ContentTarget, string[]>();
  for (const row of rows) {
    byKind.set(row.targetType, [...(byKind.get(row.targetType) ?? []), row.targetId]);
  }

  const found = new Map<string, TargetContent>();
  const key = (targetType: ContentTarget, targetId: string) => `${targetType}:${targetId}`;

  const reviewIds = byKind.get("review") ?? [];
  if (reviewIds.length > 0) {
    const rowsFound = await db
      .select({
        id: reviews.id,
        body: reviews.body,
        rating: reviews.rating,
        moderation: reviews.moderation,
        authorName: users.fullName,
        vendorName: vendors.name,
      })
      .from(reviews)
      .leftJoin(users, eq(users.id, reviews.authorUserId))
      .leftJoin(vendors, eq(vendors.id, reviews.vendorId))
      .where(inArray(reviews.id, reviewIds));

    for (const row of rowsFound) {
      found.set(key("review", row.id), {
        targetType: "review",
        targetId: row.id,
        body: row.body,
        authorName: row.authorName,
        moderation: row.moderation,
        context: `${row.rating}★ review of ${row.vendorName ?? "a business"}`,
        present: true,
      });
    }
  }

  const messageIds = byKind.get("message") ?? [];
  if (messageIds.length > 0) {
    const rowsFound = await db
      .select({
        id: messages.id,
        body: messages.body,
        moderation: messages.moderation,
        authorName: users.fullName,
      })
      .from(messages)
      .leftJoin(users, eq(users.id, messages.senderUserId))
      .where(inArray(messages.id, messageIds));

    for (const row of rowsFound) {
      found.set(key("message", row.id), {
        targetType: "message",
        targetId: row.id,
        body: row.body,
        authorName: row.authorName,
        moderation: row.moderation,
        context: "Message in a conversation",
        present: true,
      });
    }
  }

  const vendorIds = byKind.get("vendor_profile") ?? [];
  if (vendorIds.length > 0) {
    const rowsFound = await db
      .select({ id: vendors.id, name: vendors.name, tagline: vendors.tagline })
      .from(vendors)
      .where(inArray(vendors.id, vendorIds));

    for (const row of rowsFound) {
      found.set(key("vendor_profile", row.id), {
        targetType: "vendor_profile",
        targetId: row.id,
        body: row.tagline,
        authorName: row.name,
        moderation: null,
        context: `Profile line on ${row.name}`,
        present: true,
      });
    }
  }

  // Anything the loop above did not find has been deleted since it was
  // reported. Said out loud rather than left as a blank row: a report about
  // content that is already gone is a report somebody can close in a second,
  // and one that renders empty looks like a bug.
  for (const row of rows) {
    const id = key(row.targetType, row.targetId);
    if (!found.has(id)) {
      found.set(id, {
        targetType: row.targetType,
        targetId: row.targetId,
        body: null,
        authorName: null,
        moderation: null,
        context: "No longer on the platform",
        present: false,
      });
    }
  }

  return found;
}

/**
 * Applies a decision to the content itself.
 *
 * Returns what it changed, for the audit entry — the words that were taken
 * down are the thing somebody needs to see later, and the row they were on no
 * longer holds them.
 */
export async function applyDecision(
  db: DbExecutor,
  input: {
    targetType: ContentTarget;
    targetId: string;
    decision: ContentDecision;
    moderatorUserId: string | null;
    now: Date;
  },
): Promise<{ before: string | null; after: string | null }> {
  const { targetType, targetId, decision, moderatorUserId, now } = input;

  if (targetType === "review") {
    const [before] = await db
      .select({ body: reviews.body })
      .from(reviews)
      .where(eq(reviews.id, targetId))
      .for("update")
      .limit(1);

    const body = decision === "remove" ? REMOVED_TEXT : (before?.body ?? null);

    await db
      .update(reviews)
      .set({
        moderation: decision === "keep" ? "approved" : "rejected",
        body,
        moderatedByUserId: moderatorUserId,
        moderatedAt: now,
        updatedAt: now,
      })
      .where(eq(reviews.id, targetId));

    return { before: before?.body ?? null, after: body };
  }

  if (targetType === "message") {
    const [before] = await db
      .select({ body: messages.body })
      .from(messages)
      .where(eq(messages.id, targetId))
      .for("update")
      .limit(1);

    const body = decision === "remove" ? REMOVED_TEXT : (before?.body ?? REMOVED_TEXT);

    await db
      .update(messages)
      .set({
        moderation: decision === "keep" ? "approved" : "rejected",
        body,
        moderatedByUserId: moderatorUserId,
        moderatedAt: now,
        updatedAt: now,
      })
      .where(eq(messages.id, targetId));

    return { before: before?.body ?? null, after: body };
  }

  const [before] = await db
    .select({ tagline: vendors.tagline })
    .from(vendors)
    .where(eq(vendors.id, targetId))
    .for("update")
    .limit(1);

  // `keep` changes nothing at all here: there is no moderation column on a
  // business record, and writing `updated_at` would make a decision to leave
  // something alone look like an edit to it.
  if (decision === "keep") {
    return { before: before?.tagline ?? null, after: before?.tagline ?? null };
  }

  await db
    .update(vendors)
    .set({ tagline: null, updatedAt: now })
    .where(eq(vendors.id, targetId));

  return { before: before?.tagline ?? null, after: null };
}

/** Reports already filed against one piece of content. */
export async function listForTarget(
  db: DbExecutor,
  targetType: ContentTarget,
  targetId: string,
): Promise<ReportRow[]> {
  const rows = await db
    .select({
      id: contentReports.id,
      targetType: contentReports.targetType,
      targetId: contentReports.targetId,
      reporterUserId: contentReports.reporterUserId,
      reporterName: reporters.fullName,
      reason: contentReports.reason,
      detail: contentReports.detail,
      decision: contentReports.decision,
      decidedByUserId: contentReports.decidedByUserId,
      decidedAt: contentReports.decidedAt,
      decisionNote: contentReports.decisionNote,
      createdAt: contentReports.createdAt,
    })
    .from(contentReports)
    .leftJoin(reporters, eq(reporters.id, contentReports.reporterUserId))
    .where(and(eq(contentReports.targetType, targetType), eq(contentReports.targetId, targetId)))
    .orderBy(desc(contentReports.createdAt));

  return withDeciders(db, rows as ReportRow[]);
}
