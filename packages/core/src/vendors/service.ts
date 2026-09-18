import { record } from "../audit/service.js";
import type { CoreContext, DbExecutor } from "../context.js";
import { NotFoundError, ValidationError } from "../errors.js";
import type { Actor } from "../identity/actor.js";
import { assertCanActOnVendor, assertCanReadVendorPrivately } from "../identity/policies.js";
import { requireAdmin } from "../identity/service.js";
import * as repo from "./repo.js";
import {
  assertTransition,
  capabilityEndsOnEntering,
  payoutAllowed,
  payoutsStopOnEntering,
  reasonRequiredOnEntering,
  standingHoldReason,
  type VendorStatus,
} from "./transitions.js";

/**
 * The vendor approval queue.
 *
 * Two rules hold across everything here. Every entry point calls
 * `requireAdmin()` — the role gate — and every one that names a vendor id then
 * calls an object policy, because a role check answers "an admin may use this"
 * and not "this admin may touch that row".
 *
 * The second rule is the one this phase exists for: **a status change is one
 * transaction.** Moving a vendor out of `approved` has to stop the money
 * already scheduled for them and end their staff's sessions, and those are not
 * three operations that happen to run together. A crash between the first and
 * the second leaves the platform paying a business it has just suspended.
 */

/** How a vendor is drawn in the queue. */
export type AdminVendorRow = {
  id: string;
  name: string;
  slug: string;
  status: VendorStatus;
  /** `Flowers · Liberty Village · Stripe test connected`, as the prototype writes it. */
  detail: string;
  baseArea: string | null;
  categoryName: string | null;
  serviceCount: number;
};

export type AdminVendorList = {
  rows: AdminVendorRow[];
  /** Every vendor, by status — the chips show these whatever the filter is. */
  counts: Record<VendorStatus, number>;
  total: number;
};

export type VendorFilter = {
  status?: VendorStatus | undefined;
  search?: string | undefined;
};

/**
 * The queue itself.
 *
 * A list rather than a row lookup, so the role gate is the whole authorization
 * story: there is no entity id here for an object policy to be asked about.
 */
export async function listVendorsForAdmin(
  ctx: CoreContext,
  actor: Actor,
  filter: VendorFilter = {},
): Promise<AdminVendorList> {
  requireAdmin(actor);

  const [rows, counts] = await Promise.all([
    repo.listForAdmin(ctx.db, filter),
    repo.countByStatus(ctx.db),
  ]);

  return {
    rows: rows.map((row) => toRow(ctx, row)),
    counts,
    total: counts.pending + counts.approved + counts.suspended + counts.blocked,
  };
}

/** One entry on the drawer's onboarding checklist. */
export type OnboardingStep = {
  id: string;
  label: string;
  done: boolean;
  /** What is missing, when it is not done. */
  detail: string;
};

export type VendorDetail = {
  vendor: AdminVendorRow;
  stripe: {
    accountId: string | null;
    status: string | null;
    mode: "test" | "live";
    chargesEnabledAt: Date | null;
    payoutsEnabledAt: Date | null;
    /** When this mirror was last written. Phase 8 refreshes it on open. */
    checkedAt: Date;
  };
  hst: { number: string | null; registeredAt: Date | null };
  suspension: { at: Date | null; reason: string | null };
  onboarding: OnboardingStep[];
  members: repo.VendorMemberRow[];
  heldTransfers: repo.HeldTransferRow[];
  heldJobs: repo.HeldJobRow[];
  history: repo.StatusHistoryRow[];
};

/**
 * Everything one vendor's record holds.
 *
 * Administrators only — this carries staff email addresses, held payouts and
 * the audit trail. The object policy is called as well as the role gate, which
 * looks redundant while the gate is the stricter of the two: it is the rule
 * this repository keeps, so that the day a vendor's own dashboard reads this
 * the check is already here rather than being remembered then.
 */
export async function getVendorDetail(
  ctx: CoreContext,
  actor: Actor,
  vendorId: string,
): Promise<VendorDetail> {
  requireAdmin(actor);
  assertCanReadVendorPrivately(actor, { id: vendorId });
  assertVendorId(vendorId);

  const row = await repo.load(ctx.db, vendorId);
  if (!row) throw new NotFoundError("No such vendor.");

  const onboarding = await repo.loadOnboarding(ctx.db, vendorId);
  if (!onboarding) throw new NotFoundError("No such vendor.");

  const [members, heldTransfers, heldJobs, history] = await Promise.all([
    repo.listMembers(ctx.db, vendorId),
    repo.listHeldTransfers(ctx.db, vendorId),
    repo.listHeldJobs(ctx.db, vendorId),
    repo.listStatusHistory(ctx.db, vendorId),
  ]);

  return {
    vendor: toRow(ctx, row),
    stripe: {
      accountId: onboarding.stripeAccountId,
      status: onboarding.stripeStatus,
      mode: ctx.stripe.mode(),
      chargesEnabledAt: onboarding.stripeChargesEnabled,
      payoutsEnabledAt: onboarding.stripePayoutsEnabled,
      checkedAt: row.updatedAt,
    },
    hst: { number: onboarding.hstNumber, registeredAt: onboarding.hstRegistered },
    suspension: { at: onboarding.suspendedAt, reason: onboarding.suspendedReason },
    onboarding: checklist(onboarding),
    members,
    heldTransfers,
    heldJobs,
    history,
  };
}

/** What a status change did, so the caller can say so. */
export type StatusChange = {
  vendorId: string;
  name: string;
  from: VendorStatus;
  to: VendorStatus;
  /** Payouts parked by this change. */
  heldTransfers: number;
  heldJobs: number;
  /** Payouts released by it. */
  releasedTransfers: number;
  releasedJobs: number;
  /** Staff whose sessions it ended. */
  endedSessions: number;
};

/** `pending → approved`, and `blocked → approved` for a business that fixed it. */
export function approveVendor(
  ctx: CoreContext,
  actor: Actor,
  vendorId: string,
): Promise<StatusChange> {
  return changeStatus(ctx, actor, vendorId, "approved", "vendor.approve");
}

/** `approved → suspended`. Stops the money and ends the staff's sessions. */
export function suspendVendor(
  ctx: CoreContext,
  actor: Actor,
  vendorId: string,
  reason: string,
): Promise<StatusChange> {
  return changeStatus(ctx, actor, vendorId, "suspended", "vendor.suspend", reason);
}

/** `pending → blocked`, for an application that is refused rather than delayed. */
export function blockVendor(
  ctx: CoreContext,
  actor: Actor,
  vendorId: string,
  reason: string,
): Promise<StatusChange> {
  return changeStatus(ctx, actor, vendorId, "blocked", "vendor.block", reason);
}

/** `suspended → approved`. Releases what the suspension parked. */
export function reinstateVendor(
  ctx: CoreContext,
  actor: Actor,
  vendorId: string,
): Promise<StatusChange> {
  return changeStatus(ctx, actor, vendorId, "approved", "vendor.reinstate");
}

/**
 * `blocked → pending`: back into the queue for a second look.
 *
 * The prototype's "Review" button does not say what it does (its `onToggle` is
 * empty, line 2718). On screen it opens the record; this is the decision that
 * can follow — a blocked business that has since finished onboarding rejoins
 * the queue rather than being approved from the row.
 */
export function markUnderReview(
  ctx: CoreContext,
  actor: Actor,
  vendorId: string,
): Promise<StatusChange> {
  return changeStatus(ctx, actor, vendorId, "pending", "vendor.review");
}

/**
 * Every status change, and the effects that are part of it.
 *
 * One transaction, with the row locked before the transition is checked. The
 * lock is not decoration: two administrators approving the same pending vendor
 * would otherwise both read `pending`, both pass the check, and the second
 * would run a `pending → approved` change's effects against a row that is
 * already approved.
 */
async function changeStatus(
  ctx: CoreContext,
  actor: Actor,
  vendorId: string,
  to: VendorStatus,
  action: string,
  reason?: string,
): Promise<StatusChange> {
  requireAdmin(actor);
  assertCanActOnVendor(actor, { id: vendorId });
  assertVendorId(vendorId);

  const trimmed = reason?.trim();
  if (reasonRequiredOnEntering(to) && !trimmed) {
    throw new ValidationError("Say why. The vendor is told, and the next admin reads it.", {
      reason: "required",
    });
  }

  const now = ctx.clock.now();

  return ctx.db.transaction(async (tx) => {
    const current = await repo.loadForUpdate(tx, vendorId);
    if (!current) throw new NotFoundError("No such vendor.");

    assertTransition(current.status, to);

    await repo.setStatus(tx, vendorId, to, { reason: trimmed, now });

    let heldTransfers = 0;
    let heldJobs = 0;
    let releasedTransfers = 0;
    let releasedJobs = 0;

    if (payoutsStopOnEntering(to)) {
      // Both halves. The transfer rows are money already owed; the queued job
      // is money about to be owed, and holding only the rows would let it mint
      // a fresh payout the next time the runner ticks.
      const held = standingHoldReason(to, trimmed);
      heldTransfers = await repo.holdUnpaidTransfers(tx, vendorId, held, now);
      heldJobs = await repo.holdQueuedTransferJobs(tx, vendorId, held, now);
    } else {
      // Approving has to undo what a suspension parked, or the vendor is in
      // good standing and still not paid, with nothing on screen saying why.
      // Only holds this domain wrote are released.
      ({ transfers: releasedTransfers, jobs: releasedJobs } = await repo.releaseHeldForVendor(
        tx,
        vendorId,
        now,
      ));
    }

    let endedSessions = 0;
    if (capabilityEndsOnEntering(to)) {
      // Hiding the business is not enough: its staff hold valid sessions, and
      // those sessions still reach vendor endpoints.
      const memberIds = await repo.listMemberUserIds(tx, vendorId);
      // The real clock. `now` above is the domain clock, which an admin demo
      // override can move; this cutoff is compared against a token issue time
      // the auth provider stamped, and a shifted value there would leave the
      // suspended vendor's staff signed in.
      await repo.bumpMemberSessions(tx, memberIds, ctx.clock.realNow());
      endedSessions = memberIds.length;
    }

    await record(
      ctx,
      actor,
      {
        action,
        entityType: "vendor",
        entityId: vendorId,
        before: { status: current.status },
        after: {
          status: to,
          ...(trimmed ? { reason: trimmed } : {}),
          heldTransfers,
          heldJobs,
          releasedTransfers,
          releasedJobs,
          endedSessions,
        },
      },
      // Inside the transaction: an audit row that commits on its own will
      // eventually describe a change that rolled back.
      tx,
    );

    return {
      vendorId,
      name: current.name,
      from: current.status,
      to,
      heldTransfers,
      heldJobs,
      releasedTransfers,
      releasedJobs,
      endedSessions,
    };
  });
}

/**
 * The prototype's detail line: `Flowers · Liberty Village · Stripe test connected`.
 *
 * Source: line 2715. The last part is the only one that is not stored — it is
 * the connected account's state in words, and `test` comes from the port rather
 * than being written into the string, so a live-mode deployment does not tell
 * everyone their account is a test one.
 */
function toRow(ctx: CoreContext, row: repo.VendorRow): AdminVendorRow {
  const parts = [row.categoryName, row.baseArea, stripeLabel(ctx, row.stripeStatus)].filter(
    (part): part is string => Boolean(part),
  );

  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status,
    detail: parts.join(" · "),
    baseArea: row.baseArea,
    categoryName: row.categoryName,
    serviceCount: row.serviceCount,
  };
}

function stripeLabel(ctx: CoreContext, status: string | null): string | null {
  if (status === "connected") return `Stripe ${ctx.stripe.mode()} connected`;
  // The prototype's wording for Terrace Rentals, line 2718.
  if (status === "incomplete") return "onboarding incomplete";
  return status;
}

/**
 * What a business still has to do.
 *
 * Four steps, in the order they actually happen. `onboarding_percent` is not
 * used to decide any of them — it is a display figure the seed carries from the
 * prototype (line 2632), and a checklist derived from a number nobody computes
 * would be a checklist that lies.
 */
function checklist(row: repo.VendorOnboarding): OnboardingStep[] {
  return [
    {
      id: "profile",
      label: "Business profile",
      done: Boolean(row.baseArea),
      detail: row.baseArea ? `Based in ${row.baseArea}` : "No service area set",
    },
    {
      id: "payouts",
      label: "Payouts connected",
      done: row.stripePayoutsEnabled !== null,
      detail:
        row.stripePayoutsEnabled !== null
          ? "Ready to receive transfers"
          : row.stripeAccountId
            ? "Account created, payouts not enabled"
            : "No connected account",
    },
    {
      id: "service",
      label: "First service",
      done: row.serviceCount > 0,
      detail:
        row.serviceCount > 0
          ? `${row.serviceCount} ${row.serviceCount === 1 ? "service" : "services"}`
          : "Nothing to book yet",
    },
    {
      id: "published",
      label: "Published",
      done: row.publishedServiceCount > 0,
      detail:
        row.publishedServiceCount > 0
          ? `${row.publishedServiceCount} live`
          : "Nothing visible to customers",
    },
  ];
}

/**
 * Refuses to let money move to a vendor who is not approved.
 *
 * The last line of defence, and the one that does not depend on anybody having
 * remembered to hold a row. Suspension parks the transfers and the queued jobs
 * that exist *at that moment*; this refuses a payout however it came to be
 * attempted — a job that was already running when the suspension committed, a
 * webhook arriving late, a retry of a failed transfer.
 *
 * **Call it with the transaction that makes the payout, not with `ctx.db`.**
 * It reads the row `for update`, and that lock is the whole mechanism: held
 * until the payout commits, it makes a concurrent suspension wait and then find
 * a paid transfer, instead of committing between this check and the provider
 * call and leaving a suspended vendor paid anyway. On `ctx.db` the statement
 * autocommits, the lock is released immediately, and this becomes a check with
 * a race underneath it.
 *
 * It takes no actor and calls no policy, which is the one place this domain
 * departs from the rule that entity-id functions take the actor first. There is
 * no actor to take: the caller is the job runner acting on the platform's own
 * behalf, and what this answers is a fact about the vendor rather than a
 * question about who is asking.
 */
export async function assertVendorMayBePaid(db: DbExecutor, vendorId: string): Promise<void> {
  assertVendorId(vendorId);

  const vendor = await repo.loadForUpdate(db, vendorId);
  if (!vendor) throw new NotFoundError("No such vendor.");

  if (!payoutAllowed(vendor.status)) {
    throw new ValidationError(`Payouts to a ${vendor.status} vendor are held.`, {
      vendorStatus: vendor.status,
    });
  }
}

/**
 * Refuses an id that is not one before it reaches the database.
 *
 * The id arrives from a query parameter or a form field, so "not a vendor" and
 * "not a uuid" are both things a person can type. Without this the second
 * becomes a driver error and an error page; the honest answer to both is that
 * there is no such vendor.
 */
function assertVendorId(value: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new NotFoundError("No such vendor.");
  }
}
