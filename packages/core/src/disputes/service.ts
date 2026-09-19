import { record } from "../audit/service.js";
import type { CoreContext, DbExecutor } from "../context.js";
import { NotFoundError, ValidationError } from "../errors.js";
import { isAuthenticated, type Actor } from "../identity/actor.js";
import { assertCanActOnOrder } from "../identity/policies.js";
import { requireAdmin } from "../identity/service.js";
import { parties as orderParties, resolveIssue } from "../ordering/service.js";
import { parseOrderState, type OrderState } from "../ordering/transitions.js";
import * as repo from "./repo.js";
import {
  assertTransition,
  disputeResolutionLabel,
  disputeStateLabel,
  isOpen,
  parseDisputeResolution,
  stateFor,
  type DisputeResolution,
  type DisputeState,
} from "./transitions.js";

/**
 * Complaints, and what an administrator does about them.
 *
 * Two rules, the same two the rest of the admin domain keeps. Every entry point
 * calls `requireAdmin()`, and every one that names a case then runs the order
 * policy on the booking behind it — the case is about somebody's order, and a
 * screen that could reach one by id could reach the order through it.
 *
 * The third rule is this module's own: **a case and the order it is about move
 * together.** Resolving a complaint on an order that is sitting in `issue` has
 * to take the order out of `issue`, and a crash between the two leaves a
 * booking frozen with nobody left to unfreeze it — the case that would have
 * said why is closed.
 */

export type DisputeSummary = repo.DisputeRow & {
  stateLabel: string;
  resolutionLabel: string | null;
  /** Whether it is still somebody's to deal with. */
  open: boolean;
};

export type DisputeList = {
  rows: DisputeSummary[];
  counts: Record<DisputeState, number>;
  total: number;
};

export type DisputeFilter = repo.DisputeFilter;

function summarise(row: repo.DisputeRow): DisputeSummary {
  return {
    ...row,
    stateLabel: disputeStateLabel(row.state),
    resolutionLabel: row.resolution ? disputeResolutionLabel(row.resolution) : null,
    open: isOpen(row.state),
  };
}

/**
 * The queue.
 *
 * A list rather than a row lookup, so the role gate is the whole authorization
 * story: there is no entity id here for an object policy to be asked about.
 */
export async function listDisputes(
  ctx: CoreContext,
  actor: Actor,
  filter: DisputeFilter = {},
): Promise<DisputeList> {
  requireAdmin(actor);

  const [rows, counts] = await Promise.all([
    repo.listForAdmin(ctx.db, filter),
    repo.countByState(ctx.db),
  ]);

  return {
    rows: rows.map(summarise),
    counts,
    total: counts.open + counts.under_review + counts.resolved + counts.rejected,
  };
}

export type DisputeDetail = {
  dispute: DisputeSummary;
  notes: repo.DisputeNote[];
  /** Whether the order is waiting on this case to be closed. */
  orderInIssue: boolean;
};

/** One case file. */
export async function getDispute(
  ctx: CoreContext,
  actor: Actor,
  disputeId: string,
): Promise<DisputeDetail> {
  requireAdmin(actor);

  const dispute = await repo.load(ctx.db, disputeId);
  if (!dispute) throw new NotFoundError("No such case.");

  // The order policy as well as the role gate. Redundant while the gate is the
  // stricter of the two, and the rule this repository keeps so that the day a
  // vendor can see a complaint against them the check is already here.
  assertCanActOnOrder(actor, await orderParties(ctx, dispute.orderId));

  const notes = await repo.listNotes(ctx.db, disputeId);

  return {
    dispute: summarise(dispute),
    notes,
    orderInIssue: dispute.orderState === "issue",
  };
}

/**
 * Records a complaint that arrived some other way.
 *
 * An administrator takes a phone call or an email and opens the case here; the
 * customer-facing route into this belongs with the customer views. The actor is
 * not the complainant — `raisedByUserId` is the order's customer, because the
 * complaint is theirs whoever typed it in.
 */
export async function openDispute(
  ctx: CoreContext,
  actor: Actor,
  orderId: string,
  input: { reason: string; detail?: string | undefined; amount?: bigint | undefined },
): Promise<string> {
  requireAdmin(actor);

  const parties = await orderParties(ctx, orderId);
  assertCanActOnOrder(actor, parties);

  const reason = input.reason.trim();
  if (!reason) {
    throw new ValidationError("Say what the complaint is about.", { reason: "required" });
  }

  const now = ctx.clock.now();

  return ctx.db.transaction(async (tx) => {
    const disputeId = await repo.insertDispute(tx, {
      orderId,
      raisedByUserId: parties.userId,
      reason: reason.slice(0, 200),
      detail: input.detail?.trim().slice(0, 2000) ?? null,
      amount: input.amount ?? null,
      now,
    });

    await record(
      ctx,
      actor,
      {
        action: "dispute.open",
        entityType: "dispute",
        entityId: disputeId,
        after: { orderId, reason: reason.slice(0, 200), state: "open" },
      },
      tx,
    );

    return disputeId;
  });
}

/**
 * Adds an internal note.
 *
 * Internal is the only kind in this milestone: there is no customer-facing view
 * of a case yet, so a note written here is read by administrators and nobody
 * else. It is said out loud in the screen rather than implied, because the
 * difference matters the first time somebody writes "the vendor is lying".
 */
export async function addDisputeNote(
  ctx: CoreContext,
  actor: Actor,
  disputeId: string,
  body: string,
): Promise<string> {
  requireAdmin(actor);

  const dispute = await requireCase(ctx, actor, disputeId);

  const trimmed = body.trim();
  if (!trimmed) {
    throw new ValidationError("A note needs something in it.", { body: "required" });
  }

  const now = ctx.clock.now();

  return ctx.db.transaction(async (tx) => {
    const noteId = await repo.insertNote(tx, {
      disputeId: dispute.id,
      authorUserId: isAuthenticated(actor) ? actor.userId : null,
      body: trimmed.slice(0, 4000),
      now,
    });

    await record(
      ctx,
      actor,
      {
        action: "dispute.note",
        entityType: "dispute",
        entityId: dispute.id,
        // The note itself, not merely that one was written: the audit log is
        // where a case is read from once the platform has moved on, and "a note
        // was added" answers nothing.
        after: { noteId, body: trimmed.slice(0, 4000) },
      },
      tx,
    );

    return noteId;
  });
}

/**
 * Picks a case up, or puts it back down.
 *
 * Assignment is how two administrators avoid answering the same complaint
 * twice. It is recorded rather than inferred from who last touched it, because
 * reading a case is not the same as owning it.
 */
export async function assignDispute(
  ctx: CoreContext,
  actor: Actor,
  disputeId: string,
  userId: string | null,
): Promise<void> {
  requireAdmin(actor);
  await requireCase(ctx, actor, disputeId);

  await ctx.db.transaction(async (tx) => {
    const before = await repo.loadForUpdate(tx, disputeId);
    if (!before) throw new NotFoundError("No such case.");

    await repo.setAssignee(tx, disputeId, userId, ctx.clock.now());

    await record(
      ctx,
      actor,
      {
        action: "dispute.assign",
        entityType: "dispute",
        entityId: disputeId,
        before: { assignedToUserId: before.assignedToUserId },
        after: { assignedToUserId: userId },
      },
      tx,
    );
  });
}

/** Moves a case to `under_review` — somebody is looking at it. */
export async function startDisputeReview(
  ctx: CoreContext,
  actor: Actor,
  disputeId: string,
): Promise<void> {
  requireAdmin(actor);
  await requireCase(ctx, actor, disputeId);

  await ctx.db.transaction(async (tx) => {
    const before = await repo.loadForUpdate(tx, disputeId);
    if (!before) throw new NotFoundError("No such case.");

    assertTransition(before.state, "under_review");

    await repo.setState(tx, disputeId, {
      state: "under_review",
      resolution: null,
      resolutionNote: before.resolutionNote,
      resolvedAt: null,
      now: ctx.clock.now(),
    });

    await record(
      ctx,
      actor,
      {
        action: "dispute.review",
        entityType: "dispute",
        entityId: disputeId,
        before: { state: before.state },
        after: { state: "under_review" },
      },
      tx,
    );
  });
}

export type ResolveDisputeInput = {
  /** Parsed here, so a form value and a typed caller take the same path. */
  resolution: string;
  note: string;
  /**
   * Where the order goes, when it is sitting in `issue`.
   *
   * Required in that case and refused otherwise: an order that is not waiting
   * on this complaint must not be moved by closing it.
   */
  orderTo?: string | undefined;
};

export type ResolveDisputeResult = {
  state: DisputeState;
  resolution: DisputeResolution;
  /** The state the order was moved to, when it was in `issue`. */
  orderState: OrderState | null;
};

/**
 * Closes a case, and takes the order with it.
 *
 * The two writes are one transaction. An order in `issue` is frozen — payouts
 * are held and the lifecycle will not move it — and the case is the record of
 * why. Closing one without the other leaves either a frozen booking nobody can
 * explain, or a complaint marked settled against an order still waiting.
 */
export async function resolveDispute(
  ctx: CoreContext,
  actor: Actor,
  disputeId: string,
  input: ResolveDisputeInput,
): Promise<ResolveDisputeResult> {
  requireAdmin(actor);

  const dispute = await requireCase(ctx, actor, disputeId);

  const resolution = parseDisputeResolution(input.resolution);
  const note = input.note.trim();
  if (!note) {
    throw new ValidationError("Say how the complaint was resolved.", { note: "required" });
  }

  const inIssue = dispute.orderState === "issue";
  const orderTo = input.orderTo === undefined ? undefined : parseOrderState(input.orderTo);

  if (inIssue && orderTo === undefined) {
    throw new ValidationError(
      "The order is held on this complaint. Say where it goes once the case is closed.",
      { orderTo: "required" },
    );
  }
  if (!inIssue && orderTo !== undefined) {
    throw new ValidationError("That order is not waiting on this complaint.", {
      orderTo: "not_applicable",
    });
  }
  if (orderTo !== undefined && orderTo !== "confirmed" && orderTo !== "fulfilled" && orderTo !== "cancelled") {
    throw new ValidationError("An issue is resolved to confirmed, fulfilled or cancelled.", {
      orderTo: "illegal",
    });
  }

  const state = stateFor(resolution);
  const now = ctx.clock.now();

  return ctx.db.transaction(async (tx) => {
    const before = await repo.loadForUpdate(tx, disputeId);
    if (!before) throw new NotFoundError("No such case.");

    assertTransition(before.state, state);

    // The order first. It is the write that can be refused on grounds this
    // module does not know about — a state the lifecycle will not allow — and
    // discovering that after the case is closed would mean rolling back a
    // resolution somebody has already been told about.
    if (orderTo !== undefined) {
      const scoped: CoreContext = { ...ctx, db: tx as unknown as CoreContext["db"] };
      await resolveIssue(scoped, actor, before.orderId, orderTo, note);
    }

    await repo.setState(tx, disputeId, {
      state,
      resolution,
      resolutionNote: note.slice(0, 2000),
      resolvedAt: now,
      now,
    });

    await record(
      ctx,
      actor,
      {
        action: "dispute.resolve",
        entityType: "dispute",
        entityId: disputeId,
        before: { state: before.state, resolution: before.resolution },
        after: {
          state,
          resolution,
          note: note.slice(0, 2000),
          orderState: orderTo ?? null,
        },
      },
      tx,
    );

    return { state, resolution, orderState: orderTo ?? null };
  });
}

/**
 * Closes the cases an order's own "resolve issue" has just settled.
 *
 * The other direction of the same link, and the reason it exists: Phase 9's
 * order screen can take a booking out of `issue` without ever opening the
 * complaints queue, and a case left open against a booking that has moved on is
 * a queue entry nobody can action.
 *
 * Not exported from the package. It signs the audit row with whichever actor it
 * is handed and asks nobody's permission, because its one caller has already
 * run the order policy — which is the same reason `applyTransition` is not on
 * the barrel either.
 */
export async function closeDisputesForOrder(
  ctx: CoreContext,
  actor: Actor,
  orderId: string,
  note: string,
  db: DbExecutor,
): Promise<number> {
  const open = await repo.listOpenForOrder(db, orderId);
  if (open.length === 0) return 0;

  const now = ctx.clock.now();

  for (const dispute of open) {
    await repo.setState(db, dispute.id, {
      state: "resolved",
      resolution: "refund_recorded",
      resolutionNote: note.slice(0, 2000),
      resolvedAt: now,
      now,
    });

    await record(
      ctx,
      actor,
      {
        action: "dispute.resolve",
        entityType: "dispute",
        entityId: dispute.id,
        before: { state: dispute.state, resolution: null },
        after: {
          state: "resolved",
          resolution: "refund_recorded",
          note: note.slice(0, 2000),
          // Named, because this row was not written by somebody opening the
          // case: it is the order screen closing what it settled.
          via: "order.resolve_issue",
        },
      },
      db,
    );
  }

  return open.length;
}

/** Cases against one order, for the order drawer. */
export async function listDisputesForOrder(
  ctx: CoreContext,
  actor: Actor,
  orderId: string,
): Promise<DisputeSummary[]> {
  requireAdmin(actor);
  assertCanActOnOrder(actor, await orderParties(ctx, orderId));

  const rows = await repo.listForOrder(ctx.db, orderId);
  return rows.map(summarise);
}

/** Loads a case and runs the order policy on the booking behind it. */
async function requireCase(
  ctx: CoreContext,
  actor: Actor,
  disputeId: string,
): Promise<repo.DisputeRow> {
  const dispute = await repo.load(ctx.db, disputeId);
  if (!dispute) throw new NotFoundError("No such case.");

  assertCanActOnOrder(actor, await orderParties(ctx, dispute.orderId));
  return dispute;
}
