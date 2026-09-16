import { NotFoundError } from "../errors.js";
import { belongsToVendor, isAdmin, isAuthenticated, isUsable, type Actor } from "./actor.js";

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
 */

/** The parties an order can belong to. */
export type OrderParties = {
  id: string;
  userId: string;
  vendorId: string;
};

export function assertCanReadOrder(actor: Actor, order: OrderParties): void {
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
  if (!isUsable(actor)) throw new NotFoundError("No such order.");
  if (isAdmin(actor)) return;

  if (!belongsToVendor(actor, order.vendorId)) {
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
