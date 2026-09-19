import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  disputeMessages,
  disputes,
  orders,
  users,
  vendors,
} from "@occasion/db/schema";
import type { DbExecutor } from "../context.js";
import type { DisputeResolution, DisputeState } from "./transitions.js";

/**
 * Database access for the complaints queue.
 *
 * Every function takes an executor rather than the context: resolving a case
 * moves the order it is about, writes the case, and writes the audit row, and
 * those three are one transaction or they are a case file that disagrees with
 * the booking it describes.
 */

export type DisputeRow = {
  id: string;
  orderId: string;
  orderReference: string;
  orderState: string;
  vendorName: string;
  customerName: string;
  raisedByUserId: string | null;
  state: DisputeState;
  resolution: DisputeResolution | null;
  reason: string;
  detail: string | null;
  amount: bigint | null;
  currency: string;
  assignedToUserId: string | null;
  assignedToName: string | null;
  resolutionNote: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
  noteCount: number;
};

const customers = users;

/**
 * The queue, with everything a row shows.
 *
 * One query with joins rather than a case lookup per row: the screen lists
 * complaints with the order, the business and the customer on each line, and
 * fetching those per case is the N+1 the render budget forbids.
 */
function disputesWithContext(db: DbExecutor) {
  const notes = sql<number>`(
    select count(*)::int from ${disputeMessages}
    where ${disputeMessages.disputeId} = ${disputes.id}
  )`;

  return db
    .select({
      id: disputes.id,
      orderId: disputes.orderId,
      orderReference: orders.reference,
      orderState: orders.state,
      vendorName: vendors.name,
      customerName: customers.fullName,
      raisedByUserId: disputes.raisedByUserId,
      state: disputes.state,
      resolution: disputes.resolution,
      reason: disputes.reason,
      detail: disputes.detail,
      amount: disputes.amount,
      currency: disputes.currency,
      assignedToUserId: disputes.assignedToUserId,
      resolutionNote: disputes.resolutionNote,
      resolvedAt: disputes.resolvedAt,
      createdAt: disputes.createdAt,
      noteCount: notes,
    })
    .from(disputes)
    .innerJoin(orders, eq(orders.id, disputes.orderId))
    .innerJoin(vendors, eq(vendors.id, orders.vendorId))
    .innerJoin(customers, eq(customers.id, orders.userId));
}

export type DisputeFilter = {
  state?: DisputeState | undefined;
  /** Only cases nobody has picked up. */
  unassigned?: boolean | undefined;
};

export async function listForAdmin(
  db: DbExecutor,
  filter: DisputeFilter = {},
): Promise<DisputeRow[]> {
  const conditions = [
    ...(filter.state ? [eq(disputes.state, filter.state)] : []),
    ...(filter.unassigned ? [sql`${disputes.assignedToUserId} is null`] : []),
  ];

  const rows = await disputesWithContext(db)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    // Oldest first: a queue is worked from the front, and the complaint that
    // has been waiting longest is the one somebody is most annoyed about.
    .orderBy(asc(disputes.createdAt));

  return withAssignees(db, rows as DisputeRow[]);
}

export async function countByState(db: DbExecutor): Promise<Record<DisputeState, number>> {
  const rows = await db
    .select({ state: disputes.state, total: sql<number>`count(*)::int` })
    .from(disputes)
    .groupBy(disputes.state);

  const counts: Record<DisputeState, number> = {
    open: 0,
    under_review: 0,
    resolved: 0,
    rejected: 0,
  };
  for (const row of rows) counts[row.state] = row.total;
  return counts;
}

export async function load(db: DbExecutor, disputeId: string): Promise<DisputeRow | undefined> {
  const rows = await disputesWithContext(db).where(eq(disputes.id, disputeId)).limit(1);
  const [row] = await withAssignees(db, rows as DisputeRow[]);
  return row;
}

/**
 * The row, locked, with the order's parties.
 *
 * `FOR UPDATE` on the case alone: it is the row every write below changes, and
 * locking the order here as well would take the two in a different order from
 * the transition that follows, which is how two administrators resolving two
 * cases on one order deadlock.
 */
export async function loadForUpdate(
  db: DbExecutor,
  disputeId: string,
): Promise<
  | {
      id: string;
      orderId: string;
      state: DisputeState;
      resolution: DisputeResolution | null;
      assignedToUserId: string | null;
      resolutionNote: string | null;
    }
  | undefined
> {
  const [row] = await db
    .select({
      id: disputes.id,
      orderId: disputes.orderId,
      state: disputes.state,
      resolution: disputes.resolution,
      assignedToUserId: disputes.assignedToUserId,
      resolutionNote: disputes.resolutionNote,
    })
    .from(disputes)
    .where(eq(disputes.id, disputeId))
    .for("update")
    .limit(1);

  return row;
}

/** The names behind `assigned_to_user_id`, in one query rather than per row. */
async function withAssignees(db: DbExecutor, rows: DisputeRow[]): Promise<DisputeRow[]> {
  const ids = [...new Set(rows.flatMap((row) => (row.assignedToUserId ? [row.assignedToUserId] : [])))];
  if (ids.length === 0) {
    return rows.map((row) => ({ ...row, assignedToName: null }));
  }

  const found = await db
    .select({ id: users.id, fullName: users.fullName })
    .from(users)
    .where(inArray(users.id, ids));

  const names = new Map(found.map((row) => [row.id, row.fullName]));
  return rows.map((row) => ({
    ...row,
    assignedToName: row.assignedToUserId ? (names.get(row.assignedToUserId) ?? null) : null,
  }));
}

export type DisputeNote = {
  id: string;
  authorUserId: string | null;
  authorName: string | null;
  body: string;
  createdAt: Date;
};

export async function listNotes(db: DbExecutor, disputeId: string): Promise<DisputeNote[]> {
  const rows = await db
    .select({
      id: disputeMessages.id,
      authorUserId: disputeMessages.authorUserId,
      authorName: users.fullName,
      body: disputeMessages.body,
      createdAt: disputeMessages.createdAt,
    })
    .from(disputeMessages)
    .leftJoin(users, eq(users.id, disputeMessages.authorUserId))
    .where(eq(disputeMessages.disputeId, disputeId))
    .orderBy(asc(disputeMessages.createdAt));

  return rows;
}

export async function insertDispute(
  db: DbExecutor,
  input: {
    orderId: string;
    raisedByUserId: string | null;
    reason: string;
    detail: string | null;
    amount: bigint | null;
    now: Date;
  },
): Promise<string> {
  const [row] = await db
    .insert(disputes)
    .values({
      orderId: input.orderId,
      raisedByUserId: input.raisedByUserId,
      reason: input.reason,
      detail: input.detail,
      amount: input.amount,
      state: "open",
      createdAt: input.now,
      updatedAt: input.now,
    })
    .returning({ id: disputes.id });

  return row?.id as string;
}

export async function insertNote(
  db: DbExecutor,
  input: { disputeId: string; authorUserId: string | null; body: string; now: Date },
): Promise<string> {
  const [row] = await db
    .insert(disputeMessages)
    .values({
      disputeId: input.disputeId,
      authorUserId: input.authorUserId,
      body: input.body,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .returning({ id: disputeMessages.id });

  return row?.id as string;
}

export async function setState(
  db: DbExecutor,
  disputeId: string,
  input: {
    state: DisputeState;
    resolution: DisputeResolution | null;
    resolutionNote: string | null;
    resolvedAt: Date | null;
    now: Date;
  },
): Promise<void> {
  await db
    .update(disputes)
    .set({
      state: input.state,
      resolution: input.resolution,
      resolutionNote: input.resolutionNote,
      resolvedAt: input.resolvedAt,
      updatedAt: input.now,
    })
    .where(eq(disputes.id, disputeId));
}

export async function setAssignee(
  db: DbExecutor,
  disputeId: string,
  userId: string | null,
  now: Date,
): Promise<void> {
  await db
    .update(disputes)
    .set({ assignedToUserId: userId, updatedAt: now })
    .where(eq(disputes.id, disputeId));
}

/** The open cases against one order, oldest first. */
export async function listOpenForOrder(
  db: DbExecutor,
  orderId: string,
): Promise<{ id: string; state: DisputeState }[]> {
  return db
    .select({ id: disputes.id, state: disputes.state })
    .from(disputes)
    .where(and(eq(disputes.orderId, orderId), inArray(disputes.state, ["open", "under_review"])))
    .orderBy(asc(disputes.createdAt));
}

/** Recent cases against one order, for the order drawer. */
export async function listForOrder(db: DbExecutor, orderId: string): Promise<DisputeRow[]> {
  const rows = await disputesWithContext(db)
    .where(eq(disputes.orderId, orderId))
    .orderBy(desc(disputes.createdAt));

  return withAssignees(db, rows as DisputeRow[]);
}
