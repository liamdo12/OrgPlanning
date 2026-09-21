import { NotFoundError } from "../errors.js";
import {
  belongsToVendor,
  isAdmin,
  isAuthenticated,
  isSystem,
  isUsable,
  type Actor,
} from "./actor.js";

/**
 * Object-level access. The second authorization layer.
 *
 * A role gate answers "may a vendor use the order endpoint". It does not
 * answer "is this vendor a party to *this* order", and that gap is a real
 * vulnerability rather than a theoretical one: with role checks alone, any
 * vendor who can guess or is given another vendor's order id reads it.
 *
 * So every domain function that takes an entity id takes the actor first and
 * calls one of these before returning anything.
 *
 * All of them throw `NotFoundError`, never `ForbiddenError`. Answering "you
 * may not see order X" confirms that order X exists, which turns an id
 * parameter into an enumeration oracle. "No such order" is the same answer
 * whether the row is absent or simply not theirs.
 *
 * Each one also refuses an account that may not act at all. The role gate
 * already checks status, but these are reachable on their own, and the rule
 * this repo documents — "every entity-id function calls a policy" — would
 * otherwise hand a suspended administrator everything.
 *
 * The three **order** policies also admit `SYSTEM`, the platform's own
 * principal, and nothing else does. The job runner charges a balance and pays
 * out a vendor on a timer, and the party to those orders is the platform rather
 * than a person — but it has no business approving a vendor or touching an
 * account, so those policies refuse it exactly as they refuse anyone else, and
 * `requireAdmin` refuses it too.
 */

/** The parties an order can belong to. */
export type OrderParties = {
  id: string;
  userId: string;
  vendorId: string;
};

export function assertCanReadOrder(actor: Actor, order: OrderParties): void {
  if (isSystem(actor)) return;
  if (!isUsable(actor)) throw new NotFoundError("No such order.");
  if (isAdmin(actor)) return;

  const isCustomer = order.userId === actor.userId;
  const isVendorStaff = belongsToVendor(actor, order.vendorId);

  if (!isCustomer && !isVendorStaff) {
    throw new NotFoundError("No such order.");
  }
}

/**
 * Acting on an order — marking it fulfilled, refunding it — is narrower than
 * reading it. A customer may look at their own order without being able to
 * change its state.
 */
export function assertCanActOnOrder(actor: Actor, order: OrderParties): void {
  if (isSystem(actor)) return;
  if (!isUsable(actor)) throw new NotFoundError("No such order.");
  if (isAdmin(actor)) return;

  if (!belongsToVendor(actor, order.vendorId)) {
    throw new NotFoundError("No such order.");
  }
}

/**
 * Moving money on an order: the customer whose card it is, or an administrator.
 *
 * Deliberately a third answer rather than either of the two above. Reading is
 * too wide — it admits the vendor's staff, and a vendor who can make a charge
 * happen on somebody else's card is a vendor who can help themselves. Acting is
 * the wrong set entirely: it admits the vendor and excludes the one person
 * whose card it is, so the customer could not pay their own deposit.
 */
export function assertCanPayOrder(actor: Actor, order: OrderParties): void {
  if (isSystem(actor)) return;
  if (!isUsable(actor)) throw new NotFoundError("No such order.");
  if (isAdmin(actor)) return;

  if (order.userId !== actor.userId) {
    throw new NotFoundError("No such order.");
  }
}

export type VendorRef = { id: string };

/** Vendor profiles are public; this guards the private view of one. */
export function assertCanReadVendorPrivately(actor: Actor, vendor: VendorRef): void {
  if (!isUsable(actor)) throw new NotFoundError("No such vendor.");
  if (isAdmin(actor)) return;
  if (!belongsToVendor(actor, vendor.id)) {
    throw new NotFoundError("No such vendor.");
  }
}

/**
 * Changing a vendor's standing — approving, suspending — is administrative
 * only. A vendor cannot approve themselves.
 */
export function assertCanActOnVendor(actor: Actor, _vendor: VendorRef): void {
  if (!isUsable(actor) || !isAdmin(actor)) {
    throw new NotFoundError("No such vendor.");
  }
}

export type UserRef = { id: string };

/** A person may always read themselves; only an admin may read anyone else. */
export function assertCanReadUser(actor: Actor, user: UserRef): void {
  if (!isUsable(actor)) throw new NotFoundError("No such account.");
  if (isAdmin(actor)) return;
  if (!isAuthenticated(actor) || actor.userId !== user.id) {
    throw new NotFoundError("No such account.");
  }
}

/**
 * Administrative action on an account.
 *
 * Self-action is refused even for administrators: an admin suspending their own
 * account, or revoking their own admin role, locks the platform's last
 * administrator out with no way back in.
 */
export function assertCanActOnUser(actor: Actor, user: UserRef): void {
  if (!isUsable(actor) || !isAdmin(actor)) {
    throw new NotFoundError("No such account.");
  }

  if (isAuthenticated(actor) && actor.userId === user.id) {
    throw new NotFoundError("An administrator cannot act on their own account.");
  }
}

export type EventRef = { id: string; ownerUserId: string };

export function assertCanReadEvent(actor: Actor, event: EventRef): void {
  if (!isUsable(actor)) throw new NotFoundError("No such event.");
  if (isAdmin(actor)) return;
  if (!isAuthenticated(actor) || actor.userId !== event.ownerUserId) {
    throw new NotFoundError("No such event.");
  }
}

/**
 * Writing to somebody's event: booking against it, changing its date.
 *
 * The owner, and nobody else. This is the one policy here that refuses
 * administrators, and the refusal is the point rather than an oversight.
 * `assertCanReadEvent` admits them because an administrator looking at a
 * customer's event on an admin screen is legitimate; an administrator
 * *committing* that customer to a C$5,000 booking, or moving the date a
 * business has already blocked its calendar for, is not something any admin
 * screen offers and not something an audit trail could explain afterwards.
 *
 * `SYSTEM` is refused for the same reason it is refused everywhere outside the
 * three order policies: the job runner charges money on bookings that already
 * exist, and nothing it does begins one.
 *
 * `NotFoundError` in every refusal, so this is not a way to learn which event
 * ids exist.
 */
export function assertCanActOnEvent(actor: Actor, event: EventRef): void {
  // One answer for every refusal — suspended, anonymous, `SYSTEM`, an
  // administrator, or simply somebody else's event — so none of them is
  // distinguishable from the event not existing.
  if (!isUsable(actor) || isAdmin(actor) || actor.userId !== event.ownerUserId) {
    throw new NotFoundError("No such event.");
  }
}
