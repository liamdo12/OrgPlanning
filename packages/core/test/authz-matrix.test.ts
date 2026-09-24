import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type postgres from "postgres";
import type { CoreContext } from "../src/context.js";
import { ANONYMOUS, type Actor } from "../src/identity/actor.js";
import { ForbiddenError, NotFoundError, UnauthenticatedError } from "../src/errors.js";
import { getActor } from "../src/identity/service.js";
import { clearSecondFactor } from "../src/identity/service.js";
import {
  approveUser,
  getUserDetail,
  grantRoleToUser,
  reinstateAccount,
  resendVerification,
  revokeRoleFromUser,
  suspendAccount,
} from "../src/identity/admin-service.js";
import { inviteAdmin, revokeAdminInvite } from "../src/identity/invites.js";
import { serviceAvailability } from "../src/catalog/availability.js";
import { listCategoriesForBrowse } from "../src/catalog/categories.js";
import { getServiceDetail } from "../src/catalog/detail.js";
import { listPublicEventFeed } from "../src/catalog/feed.js";
import { quoteCheckout } from "../src/catalog/quote-checkout.js";
import { listSaved, toggleSaved } from "../src/catalog/saved.js";
import { searchServices } from "../src/catalog/search.js";
import { getPublicService, listPublicServices } from "../src/catalog/service.js";
import {
  approveVendor,
  blockVendor,
  getVendorDetail,
  markUnderReview,
  reinstateVendor,
  suspendVendor,
} from "../src/vendors/service.js";
import {
  autoComplete,
  cancelOrder,
  createCheckout,
  getOrder,
  markFulfilled,
  raiseIssue,
  resolveIssue,
} from "../src/ordering/service.js";
import {
  extendCheckoutWindow,
  getOrderForCustomer,
  listOrdersForCustomer,
} from "../src/ordering/customer-service.js";
import {
  getOrderDetail,
  listOrdersForAdmin,
  markOrderFulfilled,
  recordDashboardRefund,
  refundCoolingWindow,
  resolveOrderIssue,
  retryBalance,
} from "../src/ordering/admin-service.js";
import {
  chargeBalance,
  chargeDeposit,
  getOrderMoney,
  recordExternalRefund,
  refreshConnectStatus,
  refundWithinCoolingWindow,
  startConnectOnboarding,
  transferShare,
} from "../src/payments/service.js";
import { requeueJob } from "../src/jobs/admin-service.js";
import {
  addDisputeNote,
  assignDispute,
  getDispute,
  listDisputesForOrder,
  openDispute,
  resolveDispute,
  startDisputeReview,
} from "../src/disputes/service.js";
import {
  addItemToPlan,
  cancelEvent,
  createEvent,
  eventHub,
  getEvent,
  listEventsForOwner,
  removeItemFromPlan,
  updateEvent,
} from "../src/planning/service.js";
import { decideReport, getReport, reportContent } from "../src/moderation/service.js";
import {
  createCategory,
  deleteCategory,
  moveCategory,
  updateCategory,
} from "../src/reference/service.js";
import { getEmailView, setMarketingConsent } from "../src/email/service.js";
import { createDatabaseContext, ownerSql, resetDatabase, testDatabaseUrl } from "./harness.js";
import { entityIds, exportedFunctions, takesActor } from "./surface.js";

/**
 * Who may reach which row.
 *
 * The role gate and the object policy are tested on their own elsewhere. What
 * neither of those tests can say is whether every way into a row actually goes
 * past one, and against an identity that is plausible rather than absurd: not
 * "an anonymous visitor", who is refused by the first line of everything, but
 * **another vendor** and **another customer** — signed in, in good standing,
 * holding a real role, and asking about somebody else's order.
 *
 * That pair is the case a role check cannot answer and the one that was
 * missing. The matrix is a registry so that the next screen adds a row rather
 * than reasoning about it again, and the last test in this file fails the build
 * when an id-taking export is added and not listed.
 *
 * **Two shapes are allowed, and both are asserted here.** Either a function
 * calls an object policy — and then the matrix says which parties it admits —
 * or it is administrative and `requireAdmin` is the whole answer, because no
 * other role can reach it at all. What is never allowed is a third shape: an id
 * and no gate. `actor-signature.test.ts` guards the missing parameter;
 * this file guards the missing check.
 *
 * Each call runs inside a transaction that is rolled back, so the entries are
 * independent and can assert against real seeded rows without a reset between
 * them.
 */

/**
 * Thrown to unwind a transaction once its assertions have been read.
 *
 * A real `Error` rather than a symbol, so it travels through anything that only
 * rethrows errors — including the domain's own transaction wrappers.
 */
class Rollback extends Error {
  constructor() {
    super("rollback");
    this.name = "Rollback";
  }
}

const url = testDatabaseUrl();

/** The eight identities every entry is tried against. */
const IDENTITIES = [
  "anonymous",
  "customer",
  "otherCustomer",
  "vendorMember",
  "otherVendor",
  "suspended",
  "adminAsCustomer",
  "admin",
] as const;

type Identity = (typeof IDENTITIES)[number];

/** Rows the registry names. Resolved once, against the seed. */
type Subjects = {
  /** TO-4192 — Sarah's confirmed order with Bloom & Co. */
  orderId: string;
  /** Bloom & Co, the order's vendor. */
  vendorId: string;
  /** Lens Studio, whose staff are the `otherVendor` identity. */
  otherVendorId: string;
  /**
   * A vendor whose connected account the provider fake actually knows.
   *
   * `refreshConnectStatus` asks the provider before it asks anything else, and
   * a seeded account id the fake has never issued comes back as "no such
   * account" — a `NotFoundError`, indistinguishable here from a refusal.
   */
  connectedVendorId: string;
  /** Jonah Tran — never the admin, so self-action is not what refuses. */
  targetUserId: string;
  eventId: string;
  /**
   * An event of the same customer's, on a date nothing has booked.
   *
   * Every seeded order now holds its date in `capacity_blocks`, so booking
   * `serviceId` against `eventId` is booking the date TO-4192 is already
   * holding. The permitted identity would be turned away by the exclusion
   * constraint — which is not a refusal, so the row would still pass while
   * proving only that the *other* identities are refused earlier. A free date
   * keeps "does not refuse the customer" a claim about authorization.
   */
  freeEventId: string;
  /** Where a new event is held. Reference data, and no authority of its own. */
  neighbourhoodId: string;
  serviceId: string;
  /**
   * The same listing by the name its public page is keyed on.
   *
   * A slug names exactly one row, so it is an entity id in every way that
   * matters here — it is just not a uuid, which is the only reason it took this
   * long to be treated as one.
   */
  serviceSlug: string;
  jobId: string;
  inviteId: string;
  /** The seeded complaint against TO-4188. */
  disputeId: string;
  /** The seeded report against Terrace Rentals' profile line. */
  reportId: string;
  categoryId: string;
  /** The same category by the name the browse filter is keyed on. */
  categorySlug: string;
  /**
   * Content nobody has reported yet.
   *
   * Bloom & Co's profile line rather than the seeded review: `reportContent`
   * admits six identities, and the database refuses a second open report from
   * one person about one thing — so a target the seed has already had reported
   * would make one identity fail on a unique index rather than on authority.
   */
  unreportedVendorId: string;
};

type Entry = {
  /** Must name an export; the completeness test ties the two together. */
  name: string;
  /** The identities that must *not* be refused. */
  allow: readonly Identity[];
  /**
   * The subject is a row somebody owns, so the refusal must be `NotFoundError`
   * and may be nothing else.
   *
   * `isRefusal` below admits `ForbiddenError` and `UnauthenticatedError` too,
   * and that is right for a call that names no row: "sign in" and "this account
   * is suspended" are honest answers about the *caller*. They are the wrong
   * answer about somebody else's order, because "you may not see order X"
   * confirms order X exists and turns the id parameter into an enumeration
   * oracle. Marking the entry is what asserts that difference instead of
   * assuming it — an object policy could be replaced by a role check tomorrow
   * and every row here would still pass.
   */
  owned?: true;
  call: (ctx: CoreContext, actor: Actor, subjects: Subjects) => Promise<unknown>;
};

/** Admin-only, which after the role gate means these two and nobody else. */
const ADMIN: readonly Identity[] = ["admin", "adminAsCustomer"];
/** `assertCanReadOrder`: both parties to the order, plus an administrator. */
const READ_ORDER: readonly Identity[] = ["customer", "vendorMember", ...ADMIN];
/** `assertCanActOnOrder`: the vendor's staff, plus an administrator. */
const ACT_ON_ORDER: readonly Identity[] = ["vendorMember", ...ADMIN];
/** `assertCanPayOrder`: the customer whose card it is, plus an administrator. */
const PAY_ORDER: readonly Identity[] = ["customer", ...ADMIN];
/**
 * `assertCanActOnEvent`: the event's owner, and nobody else.
 *
 * No administrator, under either label. The planner's every button acts on the
 * event — it books against it, moves its date, closes it — so the read half is
 * guarded by the write policy too, and an administrator is refused the whole
 * screen rather than given a view of it that nothing can do anything with.
 */
const OWN_EVENT: readonly Identity[] = ["customer"];

/**
 * The four sets above that name an object policy.
 *
 * `owned` is written on each entry, so it can be left off one. An entry built
 * from one of these sets exercises a row with an owner whatever its author
 * remembered to write, and the last test in this file holds the two together.
 *
 * `quoteCheckout` and `createCheckout` spell their own `["customer"]` out
 * instead of reusing `OWN_EVENT`, and that is why they are not here: both
 * answer anonymous with `UnauthenticatedError` before any event is loaded,
 * deliberately, so that a screen can offer to sign somebody in rather than
 * telling them their cart does not exist.
 */
const OWNED_FAMILIES: readonly (readonly Identity[])[] = [
  READ_ORDER,
  ACT_ON_ORDER,
  PAY_ORDER,
  OWN_EVENT,
];

/**
 * Planning an event of one's own: anybody signed in except an administrator.
 *
 * The owner is always the actor, so no identity here can create an event for
 * somebody else. An administrator is left out because the policy above refuses
 * them on every event including their own — creating one would only manufacture
 * an event its owner could never open.
 */
const PLANS_OWN_EVENT: readonly Identity[] = [
  "customer",
  "otherCustomer",
  "vendorMember",
  "otherVendor",
];

/** Anybody signed in and in good standing — no role required. */
const SIGNED_IN: readonly Identity[] = [
  "customer",
  "otherCustomer",
  "vendorMember",
  "otherVendor",
  ...ADMIN,
];
/**
 * Nobody is refused — the answer is public.
 *
 * A legitimate entry for a read whose subject is a listing the whole internet
 * can already open. It still has to be listed, because the claim being made is
 * "this was decided", and an id-taking export missing from the registry makes
 * the same claim by silence.
 */
const EVERYONE: readonly Identity[] = IDENTITIES;

/**
 * An arbitrary day for the availability read.
 *
 * Which day it is does not matter: every identity has to get the same answer,
 * so the row is about who may ask rather than about what they are told.
 */
const ANY_DAY = "2099-06-01";

const REGISTRY: readonly Entry[] = [
  // ---- accounts ----------------------------------------------------------
  { name: "approveUser", allow: ADMIN, call: (c, a, s) => approveUser(c, a, s.targetUserId) },
  { name: "getUserDetail", allow: ADMIN, call: (c, a, s) => getUserDetail(c, a, s.targetUserId) },
  {
    name: "grantRoleToUser",
    allow: ADMIN,
    call: (c, a, s) => grantRoleToUser(c, a, s.targetUserId, "vendor", undefined),
  },
  {
    name: "reinstateAccount",
    allow: ADMIN,
    call: (c, a, s) => reinstateAccount(c, a, s.targetUserId),
  },
  {
    name: "resendVerification",
    allow: ADMIN,
    call: (c, a, s) => resendVerification(c, a, s.targetUserId),
  },
  {
    name: "revokeRoleFromUser",
    allow: ADMIN,
    call: (c, a, s) => revokeRoleFromUser(c, a, s.targetUserId, "customer"),
  },
  {
    name: "suspendAccount",
    allow: ADMIN,
    call: (c, a, s) => suspendAccount(c, a, s.targetUserId, "matrix"),
  },
  {
    name: "clearSecondFactor",
    allow: ADMIN,
    call: (c, a, s) => clearSecondFactor(c, a, s.targetUserId),
  },
  {
    name: "setMarketingConsent",
    allow: ADMIN,
    call: (c, a, s) => setMarketingConsent(c, a, s.targetUserId, { granted: true, source: "test" }),
  },
  {
    name: "revokeAdminInvite",
    allow: ADMIN,
    call: (c, a, s) => revokeAdminInvite(c, a, s.inviteId),
  },

  // ---- vendors -----------------------------------------------------------
  { name: "approveVendor", allow: ADMIN, call: (c, a, s) => approveVendor(c, a, s.otherVendorId) },
  {
    name: "blockVendor",
    allow: ADMIN,
    call: (c, a, s) => blockVendor(c, a, s.vendorId, "matrix"),
  },
  { name: "getVendorDetail", allow: ADMIN, call: (c, a, s) => getVendorDetail(c, a, s.vendorId) },
  { name: "markUnderReview", allow: ADMIN, call: (c, a, s) => markUnderReview(c, a, s.vendorId) },
  {
    name: "reinstateVendor",
    allow: ADMIN,
    call: (c, a, s) => reinstateVendor(c, a, s.vendorId),
  },
  {
    name: "suspendVendor",
    allow: ADMIN,
    call: (c, a, s) => suspendVendor(c, a, s.vendorId, "matrix"),
  },
  {
    name: "refreshConnectStatus",
    allow: ADMIN,
    call: (c, a, s) => refreshConnectStatus(c, a, s.connectedVendorId),
  },
  {
    name: "startConnectOnboarding",
    allow: ADMIN,
    call: (c, a, s) =>
      startConnectOnboarding(c, a, s.vendorId, {
        refreshUrl: "https://example.test/refresh",
        returnUrl: "https://example.test/return",
      }),
  },

  // ---- the catalogue -------------------------------------------------------
  {
    name: "quoteCheckout",
    // `assertCanActOnEvent`, exactly as `createCheckout` does — and that is the
    // point of pricing through a shared path. A quote names an event's date and
    // its guest count, so quoting somebody else's is reading somebody else's
    // event with a price on it.
    allow: ["customer"],
    call: (c, a, s) =>
      quoteCheckout(c, a, {
        eventId: s.freeEventId,
        lines: [{ serviceId: s.serviceId, quantity: 1 }],
      }),
  },
  {
    name: "serviceAvailability",
    // A listing's own calendar, on a page anybody can open. It refuses a draft
    // and a suspended business's service, which is a fact about the row rather
    // than about who asked.
    allow: EVERYONE,
    call: (c, a, s) => serviceAvailability(c, a, s.serviceId, ANY_DAY),
  },
  {
    name: "toggleSaved",
    // A shortlist belongs to a person, so it needs one — but no role. Anonymous
    // is told to sign in and a suspended account is refused.
    allow: SIGNED_IN,
    call: (c, a, s) => toggleSaved(c, a, s.serviceId),
  },

  // ---- the catalogue, with nothing to key on ------------------------------
  //
  // None of the five below takes a caller-supplied entity id, so the
  // completeness test at the bottom of this file will never ask for them. They
  // are here because that test is a floor and this registry is the record: a
  // read that answers the whole internet is still a decision somebody made, and
  // the two that are scoped to the caller's own rows are a decision about
  // *where the scope comes from*. Left out, each would make the same claim by
  // silence.
  {
    name: "searchServices",
    // The results screen. Published listings of approved businesses, filtered
    // in the query — so there is no row here belonging to anybody.
    allow: EVERYONE,
    call: (c, a) => searchServices(c, a),
  },
  {
    name: "getServiceDetail",
    // A listing's own page. `saved` is the one part of the answer that differs
    // by caller, and it is read from the caller's own shortlist rather than
    // supplied, so no identity can ask about somebody else's.
    allow: EVERYONE,
    call: (c, a, s) => getServiceDetail(c, a, s.serviceSlug),
  },
  {
    name: "listCategoriesForBrowse",
    allow: EVERYONE,
    call: (c, a) => listCategoriesForBrowse(c, a),
  },
  {
    name: "listPublicEventFeed",
    // The one read here that touches a stranger's `events` rows. It is public
    // by decision — the feed is the prototype's "what Toronto is planning" —
    // and the query is what keeps it honest: only events their owners marked
    // public, and a guest count that leaves as a band rather than a number.
    allow: EVERYONE,
    call: (c, a) => listPublicEventFeed(c, a),
  },
  {
    name: "getPublicService",
    // A listing by its slug, with the same conditions on the row: a draft and a
    // suspended business's page are `NotFoundError` to everybody, which is a
    // fact about the row rather than about who asked.
    allow: EVERYONE,
    call: (c, a, s) => getPublicService(c, a, s.serviceSlug),
  },
  {
    name: "listPublicServices",
    allow: EVERYONE,
    call: (c, a, s) => listPublicServices(c, a, { categorySlug: s.categorySlug }),
  },
  {
    name: "listSaved",
    // Nobody is refused, and that is not the same as nobody being filtered: an
    // account that may not act gets an empty list rather than an error, because
    // a shortlist is a screen to sign into rather than a row to be turned away
    // from. The rest is keyed on the caller's own user id.
    allow: EVERYONE,
    call: (c, a) => listSaved(c, a),
  },

  // ---- orders, through the lifecycle -------------------------------------
  {
    name: "getOrder",
    allow: READ_ORDER,
    owned: true,
    call: (c, a, s) => getOrder(c, a, s.orderId),
  },
  {
    name: "getOrderForCustomer",
    // The read policy, not the pay policy. The projection carries nothing a
    // vendor's staff may not see — payments, refunds and what is held, and no
    // transfers — so it is the same set `getOrder` admits.
    allow: READ_ORDER,
    owned: true,
    call: (c, a, s) => getOrderForCustomer(c, a, s.orderId),
  },
  {
    name: "listOrdersForCustomer",
    // It names an event, so the mechanical gate catches it — correctly, and the
    // answer is that there is nothing to refuse. The query is keyed on the
    // caller's own user id as well, so somebody else's event id returns an
    // empty list rather than somebody else's bookings, and the only refusals
    // are the ones `requireUser` makes: anonymous, and suspended.
    allow: SIGNED_IN,
    call: (c, a, s) => listOrdersForCustomer(c, a, { eventId: s.eventId }),
  },
  {
    name: "extendCheckoutWindow",
    // Extending the time to pay is part of paying, so it is the customer whose
    // card it is, or an administrator helping them. Never the vendor: a vendor
    // who could hold their own date open indefinitely is a vendor taking it off
    // the market for nothing.
    allow: PAY_ORDER,
    owned: true,
    call: (c, a, s) => extendCheckoutWindow(c, a, s.orderId),
  },
  {
    name: "autoComplete",
    allow: ACT_ON_ORDER,
    owned: true,
    call: (c, a, s) => autoComplete(c, a, s.orderId),
  },
  {
    name: "cancelOrder",
    allow: ACT_ON_ORDER,
    owned: true,
    call: (c, a, s) => cancelOrder(c, a, s.orderId, "order.cancel"),
  },
  {
    name: "markFulfilled",
    allow: ACT_ON_ORDER,
    owned: true,
    call: (c, a, s) => markFulfilled(c, a, s.orderId),
  },
  {
    name: "raiseIssue",
    allow: ACT_ON_ORDER,
    owned: true,
    call: (c, a, s) => raiseIssue(c, a, s.orderId, "matrix"),
  },
  {
    name: "resolveIssue",
    allow: ACT_ON_ORDER,
    owned: true,
    call: (c, a, s) => resolveIssue(c, a, s.orderId, "fulfilled", "matrix"),
  },
  {
    name: "createCheckout",
    // `assertCanActOnEvent` — the event is Sarah's, and a booking is made
    // against an event rather than against a vendor. The owner and nobody
    // else: an administrator may look at a customer's event, but committing
    // that customer to a booking and taking their card is not an admin action,
    // and the audit entry would name a person who cannot explain the charge.
    allow: ["customer"],
    call: (c, a, s) =>
      createCheckout(c, a, {
        eventId: s.freeEventId,
        lines: [{ serviceId: s.serviceId, quantity: 1 }],
      }),
  },

  // ---- orders, through the admin screen ----------------------------------
  { name: "getOrderDetail", allow: ADMIN, call: (c, a, s) => getOrderDetail(c, a, s.orderId) },
  {
    name: "listOrdersForAdmin",
    allow: ADMIN,
    call: (c, a, s) => listOrdersForAdmin(c, a, { vendorId: s.vendorId }),
  },
  {
    name: "markOrderFulfilled",
    allow: ADMIN,
    call: (c, a, s) => markOrderFulfilled(c, a, s.orderId),
  },
  {
    name: "recordDashboardRefund",
    allow: ADMIN,
    call: (c, a, s) =>
      recordDashboardRefund(c, a, s.orderId, {
        providerRefundId: "re_matrix",
        amount: 100n,
        reason: "matrix",
      }),
  },
  {
    name: "refundCoolingWindow",
    allow: ADMIN,
    call: (c, a, s) => refundCoolingWindow(c, a, s.orderId),
  },
  {
    name: "resolveOrderIssue",
    allow: ADMIN,
    call: (c, a, s) => resolveOrderIssue(c, a, s.orderId, "fulfilled", "matrix"),
  },
  { name: "retryBalance", allow: ADMIN, call: (c, a, s) => retryBalance(c, a, s.orderId) },

  // ---- planning ------------------------------------------------------------
  {
    name: "addItemToPlan",
    allow: OWN_EVENT,
    owned: true,
    call: (c, a, s) => addItemToPlan(c, a, { eventId: s.eventId, serviceId: s.serviceId }),
  },
  {
    name: "cancelEvent",
    allow: OWN_EVENT,
    owned: true,
    call: (c, a, s) => cancelEvent(c, a, s.eventId),
  },
  {
    name: "createEvent",
    allow: PLANS_OWN_EVENT,
    call: (c, a, s) =>
      createEvent(c, a, {
        name: "Matrix party",
        eventDate: "2027-06-01",
        neighbourhoodId: s.neighbourhoodId,
      }),
  },
  { name: "eventHub", allow: OWN_EVENT, owned: true, call: (c, a, s) => eventHub(c, a, s.eventId) },
  { name: "getEvent", allow: OWN_EVENT, owned: true, call: (c, a, s) => getEvent(c, a, s.eventId) },
  {
    name: "removeItemFromPlan",
    allow: OWN_EVENT,
    owned: true,
    call: (c, a, s) => removeItemFromPlan(c, a, { eventId: s.eventId, categoryId: s.categoryId }),
  },
  {
    name: "updateEvent",
    allow: OWN_EVENT,
    owned: true,
    call: (c, a, s) => updateEvent(c, a, s.eventId, { guestCount: 61 }),
  },
  {
    name: "listEventsForOwner",
    // No entity id at all, so nothing mechanical will ever ask for this row —
    // and the whole point of a registry is that a decision is written down
    // rather than inferred from silence. The actor *is* the scope: the query is
    // keyed on their own user id, so there is no other person's event to
    // refuse. `requireUser` is the only refusal, and it turns away anonymous
    // and suspended.
    allow: SIGNED_IN,
    call: (c, a) => listEventsForOwner(c, a),
  },

  // ---- money -------------------------------------------------------------
  {
    name: "chargeDeposit",
    allow: PAY_ORDER,
    owned: true,
    call: (c, a, s) => chargeDeposit(c, a, s.orderId),
  },
  {
    name: "chargeBalance",
    allow: PAY_ORDER,
    owned: true,
    call: (c, a, s) => chargeBalance(c, a, s.orderId),
  },
  {
    name: "refundWithinCoolingWindow",
    allow: PAY_ORDER,
    owned: true,
    call: (c, a, s) => refundWithinCoolingWindow(c, a, s.orderId),
  },
  {
    name: "getOrderMoney",
    allow: ACT_ON_ORDER,
    owned: true,
    call: (c, a, s) => getOrderMoney(c, a, s.orderId),
  },
  {
    name: "transferShare",
    allow: ACT_ON_ORDER,
    owned: true,
    call: (c, a, s) => transferShare(c, a, s.orderId, "deposit_share"),
  },
  {
    name: "recordExternalRefund",
    allow: ADMIN,
    call: (c, a, s) =>
      recordExternalRefund(c, a, s.orderId, {
        providerRefundId: "re_matrix_ext",
        amount: 100n,
        reason: "matrix",
      }),
  },

  // ---- complaints ---------------------------------------------------------
  { name: "getDispute", allow: ADMIN, call: (c, a, s) => getDispute(c, a, s.disputeId) },
  {
    name: "openDispute",
    allow: ADMIN,
    call: (c, a, s) => openDispute(c, a, s.orderId, { reason: "matrix" }),
  },
  {
    name: "addDisputeNote",
    allow: ADMIN,
    call: (c, a, s) => addDisputeNote(c, a, s.disputeId, "matrix"),
  },
  {
    name: "assignDispute",
    allow: ADMIN,
    // Assigned to nobody: the matrix asks who gets past the gate, and the
    // domain refuses an assignee who is not an administrator — which would be a
    // validation error arriving before the authority question was asked.
    call: (c, a, s) => assignDispute(c, a, s.disputeId, null),
  },
  {
    name: "startDisputeReview",
    allow: ADMIN,
    call: (c, a, s) => startDisputeReview(c, a, s.disputeId),
  },
  {
    name: "resolveDispute",
    allow: ADMIN,
    call: (c, a, s) =>
      resolveDispute(c, a, s.disputeId, { resolution: "vendor_warned", note: "matrix" }),
  },
  {
    name: "listDisputesForOrder",
    allow: ADMIN,
    call: (c, a, s) => listDisputesForOrder(c, a, s.orderId),
  },

  // ---- moderation ---------------------------------------------------------
  { name: "getReport", allow: ADMIN, call: (c, a, s) => getReport(c, a, s.reportId) },
  {
    name: "decideReport",
    allow: ADMIN,
    call: (c, a, s) => decideReport(c, a, s.reportId, { decision: "keep" }),
  },
  {
    name: "reportContent",
    // The one function here that is not administrative: reporting is how
    // content reaches the queue at all, so any signed-in account in good
    // standing may do it. Anonymous and suspended are still refused.
    allow: SIGNED_IN,
    call: (c, a, s) =>
      reportContent(c, a, {
        targetType: "vendor_profile",
        targetId: s.unreportedVendorId,
        reason: "matrix",
      }),
  },

  // ---- categories ---------------------------------------------------------
  {
    name: "createCategory",
    // Here because the slug it accepts is a *proposed* one rather than a row it
    // reads, which the pattern cannot tell apart and should not try to: a name
    // that decides which row is touched is worth a decision whichever direction
    // it points, and the answer here is the same `requireAdmin` the rest of this
    // section gives.
    allow: ADMIN,
    call: (c, a) => createCategory(c, a, { name: "Matrix", slug: "matrix-category" }),
  },
  {
    name: "updateCategory",
    allow: ADMIN,
    call: (c, a, s) => updateCategory(c, a, s.categoryId, { name: "Matrix" }),
  },
  {
    name: "moveCategory",
    allow: ADMIN,
    call: (c, a, s) => moveCategory(c, a, s.categoryId, "down"),
  },
  {
    name: "deleteCategory",
    allow: ADMIN,
    call: (c, a, s) => deleteCategory(c, a, s.categoryId),
  },

  // ---- operations and email ----------------------------------------------
  { name: "requeueJob", allow: ADMIN, call: (c, a, s) => requeueJob(c, a, s.jobId) },
  {
    name: "getEmailView",
    allow: ADMIN,
    call: (c, a, s) => getEmailView(c, a, { userIds: [s.targetUserId] }),
  },
];

/**
 * Id-taking exports the matrix does not exercise, and why.
 *
 * Only two kinds qualify: a policy, which *is* the decision and is asserted
 * against every identity in `policies.test.ts`, and the audit writer, whose id
 * is a label on a row rather than a row it reads.
 */
const NOT_IN_MATRIX: Readonly<Record<string, string>> = {
  assertCanActOnEvent: "A policy. Asserted directly in policies.test.ts.",
  assertCanActOnOrder: "A policy. Asserted directly in policies.test.ts.",
  assertCanActOnUser: "A policy. Asserted directly in policies.test.ts.",
  assertCanActOnVendor: "A policy. Asserted directly in policies.test.ts.",
  assertCanPayOrder: "A policy. Asserted directly in policies.test.ts.",
  assertCanReadEvent: "A policy. Asserted directly in policies.test.ts.",
  assertCanReadOrder: "A policy. Asserted directly in policies.test.ts.",
  assertCanReadUser: "A policy. Asserted directly in policies.test.ts.",
  assertCanReadVendorPrivately: "A policy. Asserted directly in policies.test.ts.",
  belongsToVendor: "The predicate the vendor policies are built from; authz.test.ts covers it.",
  recordAudit:
    "Writes the audit row. Its `entityId` labels what happened and is never read back to answer a caller.",
};

function isRefusal(error: unknown): boolean {
  return (
    error instanceof NotFoundError ||
    error instanceof ForbiddenError ||
    error instanceof UnauthenticatedError
  );
}

describe.skipIf(!url)("authorization matrix", () => {
  const dbUrl = url as string;
  let sql: postgres.Sql;
  let database: ReturnType<typeof createDatabaseContext>;
  let ctx: CoreContext;

  const actors = new Map<Identity, Actor>();
  let subjects: Subjects;

  beforeAll(async () => {
    await resetDatabase(dbUrl);
    sql = ownerSql(dbUrl);
    database = createDatabaseContext(dbUrl);
    ctx = database.ctx;

    // Bind provider subjects the way a first sign-in would.
    await sql`update app.planning_org_users set auth_provider_sub = 'provider-sub-' || email`;

    // A second vendor with staff of its own. The seed has one active vendor
    // owner, and "another vendor, signed in and in good standing" is the case
    // this whole file exists for — it cannot be borrowed from an account that
    // is pending or suspended, because then the status is what refuses.
    const [lens] = await sql<{ id: string }[]>`
      select id from app.planning_org_vendors where slug = 'lens-studio'
    `;
    const [pearl] = await sql<{ id: string }[]>`
      insert into app.planning_org_users (full_name, email, status, email_verified_at, auth_provider_sub)
      values ('Pearl Nakamura', 'pearl@lensstudio.ca', 'active', now(), 'provider-sub-pearl@lensstudio.ca')
      returning id
    `;
    await sql`
      insert into app.planning_org_user_roles (user_id, role) values (${pearl?.id as string}, 'vendor')
    `;
    await sql`
      insert into app.planning_org_vendor_members (vendor_id, user_id, role)
      values (${lens?.id as string}, ${pearl?.id as string}, 'owner')
    `;

    // The admin holds `customer` as well, which is what makes "acting as a
    // customer" a real state rather than a cookie nobody honours. The point of
    // the identity is that the switch changes the label and nothing else.
    const [adminRow] = await sql<{ id: string }[]>`
      select id from app.planning_org_users where email = 'admin@occasion.test'
    `;
    await sql`
      insert into app.planning_org_user_roles (user_id, role)
      values (${adminRow?.id as string}, 'customer')
      on conflict do nothing
    `;

    actors.set("anonymous", ANONYMOUS);
    actors.set("customer", await actorFor("sarah@example.ca"));
    actors.set("otherCustomer", await actorFor("ada.okafor@example.ca"));
    actors.set("vendorMember", await actorFor("rosa@bloomandco.ca"));
    actors.set("otherVendor", await actorFor("pearl@lensstudio.ca"));
    actors.set("suspended", await actorFor("bea@terracerentals.ca"));
    actors.set("admin", await actorFor("admin@occasion.test"));
    actors.set("adminAsCustomer", await actorFor("admin@occasion.test", "customer"));

    const [order] = await sql<{ id: string; vendor_id: string; event_id: string }[]>`
      select id, vendor_id, event_id from app.planning_org_orders where reference = 'TO-4192'
    `;
    const [service] = await sql<{ id: string; slug: string }[]>`
      select id, slug from app.planning_org_services
      where vendor_id = ${order?.vendor_id as string} limit 1
    `;
    const [job] = await sql<{ id: string }[]>`select id from app.planning_org_jobs limit 1`;
    const [jonah] = await sql<{ id: string }[]>`
      select id from app.planning_org_users where email = 'jonah.tran@example.ca'
    `;

    const invite = await inviteAdmin(ctx, actors.get("admin") as Actor, "matrix@occasion.test");

    const [dispute] = await sql<{ id: string }[]>`
      select d.id from app.planning_org_disputes d
      join app.planning_org_orders o on o.id = d.order_id
      where o.reference = 'TO-4188'
    `;
    const [report] = await sql<{ id: string }[]>`
      select id from app.planning_org_content_reports where target_type = 'vendor_profile'
    `;
    const [category] = await sql<{ id: string; slug: string }[]>`
      select id, slug from app.planning_org_categories where slug = 'decorations'
    `;
    const [neighbourhood] = await sql<{ id: string }[]>`
      select id from app.planning_org_neighbourhoods where slug = 'liberty-village'
    `;

    // An event of the order's customer, far enough out that no seeded booking
    // is holding the date. See `freeEventId`.
    const [free] = await sql<{ id: string }[]>`
      insert into app.planning_org_events (owner_user_id, name, event_date, start_time, timezone)
      select o.user_id, 'Matrix fixture', (now() + interval '500 days')::date, '17:00',
             'America/Toronto'
      from app.planning_org_orders o where o.reference = 'TO-4192'
      returning id
    `;

    // Onboard one vendor through the fake so the provider has heard of it.
    await sql`
      update app.planning_org_vendors set stripe_account_id = null where id = ${lens?.id as string}
    `;
    await startConnectOnboarding(ctx, actors.get("admin") as Actor, lens?.id as string, {
      refreshUrl: "https://example.test/refresh",
      returnUrl: "https://example.test/return",
    });

    subjects = {
      orderId: order?.id as string,
      vendorId: order?.vendor_id as string,
      otherVendorId: lens?.id as string,
      connectedVendorId: lens?.id as string,
      targetUserId: jonah?.id as string,
      eventId: order?.event_id as string,
      freeEventId: free?.id as string,
      neighbourhoodId: neighbourhood?.id as string,
      serviceId: service?.id as string,
      serviceSlug: service?.slug as string,
      jobId: job?.id as string,
      inviteId: invite.id,
      disputeId: dispute?.id as string,
      reportId: report?.id as string,
      categoryId: category?.id as string,
      categorySlug: category?.slug as string,
      unreportedVendorId: order?.vendor_id as string,
    };

    for (const [key, value] of Object.entries(subjects)) {
      if (!value) throw new Error(`matrix fixture did not resolve ${key}`);
    }
  }, 180_000);

  afterAll(async () => {
    await database?.close();
    await sql?.end({ timeout: 5 });
  });

  async function actorFor(email: string, activeRole?: "customer"): Promise<Actor> {
    database.setUser({
      id: `provider-sub-${email}`,
      email,
      issuedAt: new Date(),
      emailVerified: true,
      secondFactorVerified: true,
    });
    return getActor(ctx, activeRole ? { activeRole } : {});
  }

  /**
   * Runs one call and throws away everything it wrote.
   *
   * The permitted identities really do approve the vendor and suspend the
   * account, because a call that stops short of its write has not proved the
   * gate lets it through. A savepoint is what makes forty of those independent
   * of each other and of the seed they are asserting against.
   */
  async function attempt(entry: Entry, actor: Actor): Promise<unknown> {
    const rollback = new Rollback();
    let thrown: unknown;

    try {
      await ctx.db.transaction(async (tx) => {
        // The services take a context, and the only thing that has to change is
        // where its queries go. Drizzle's transaction handle is the same shape
        // for every call the domain makes on it.
        const scoped = { ...ctx, db: tx as unknown as CoreContext["db"] };
        try {
          await entry.call(scoped, actor, subjects);
        } catch (error) {
          thrown = error;
        }
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }

    return thrown;
  }

  describe.each(REGISTRY)("$name", (entry) => {
    const refused = IDENTITIES.filter((identity) => !entry.allow.includes(identity));

    it.each(refused)("refuses %s", async (identity) => {
      const error = await attempt(entry, actors.get(identity) as Actor);

      expect(error, `${entry.name} let ${identity} through`).toBeDefined();
      expect(isRefusal(error), `${entry.name} refused ${identity} with ${String(error)}`).toBe(
        true,
      );

      // Which refusal, for the rows that have an owner. Anything else here
      // confirms the row exists to somebody who may not read it.
      if (entry.owned) {
        expect(
          error instanceof NotFoundError,
          `${entry.name} refused ${identity} with ${String(error)}, not NotFoundError`,
        ).toBe(true);
      }
    });

    it.each(entry.allow)("does not refuse %s on authorization grounds", async (identity) => {
      const error = await attempt(entry, actors.get(identity) as Actor);

      // Not "succeeds": an administrator may legitimately be told the order is
      // in the wrong state or the amount is wrong. What may not happen is the
      // answer that means "not yours".
      expect(
        error === undefined || !isRefusal(error),
        `${entry.name} refused ${identity} with ${String(error)}`,
      ).toBe(true);
    });
  });

  it("covers every id-taking export", () => {
    const listed = new Set([...REGISTRY.map((entry) => entry.name), ...Object.keys(NOT_IN_MATRIX)]);

    const missing = exportedFunctions()
      .filter((fn) => takesActor(fn) && entityIds(fn).length > 0 && !listed.has(fn.name))
      .map(
        (fn) =>
          `${fn.name} (${fn.file}) takes ${entityIds(fn).join(", ")} and is not in the matrix`,
      );

    expect(missing).toEqual([]);
  });

  it("keeps the registry pointed at real exports", () => {
    const surface = new Set(exportedFunctions().map((fn) => fn.name));
    const stale = [...REGISTRY.map((entry) => entry.name), ...Object.keys(NOT_IN_MATRIX)].filter(
      (name) => !surface.has(name),
    );

    expect(stale).toEqual([]);
  });

  it("asks every owned-object family for the refusal that names no row", () => {
    const unmarked = REGISTRY.filter(
      (entry) => OWNED_FAMILIES.includes(entry.allow) && !entry.owned,
    ).map((entry) => entry.name);

    expect(unmarked).toEqual([]);
  });

  it("tries every identity somewhere", () => {
    // A matrix that silently stopped building one of its identities would pass
    // every row above while testing seven eighths of what it claims.
    for (const identity of IDENTITIES) {
      expect(actors.get(identity), `${identity} was never built`).toBeDefined();
    }
  });
});
