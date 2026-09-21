import { describe, expect, it } from "vitest";
import { NotFoundError } from "../errors.js";
import {
  assertCanActOnEvent,
  assertCanActOnOrder,
  assertCanActOnUser,
  assertCanActOnVendor,
  assertCanReadEvent,
  assertCanReadOrder,
  assertCanReadUser,
  assertCanReadVendorPrivately,
} from "./policies.js";
import { ANONYMOUS, SYSTEM, type Actor } from "./actor.js";

/**
 * The authorization matrix.
 *
 * The case this exists for: a vendor asking for another vendor's order id.
 * Role checks alone pass that request, because the caller genuinely is a
 * vendor — which is why every entity-id function calls an object policy as
 * well.
 */

function user(overrides: Partial<Extract<Actor, { kind: "user" }>> = {}): Actor {
  return {
    kind: "user",
    userId: "user-customer",
    email: "customer@example.ca",
    status: "active",
    roles: ["customer"],
    activeRole: "customer",
    vendorIds: [],
    ...overrides,
  };
}

const CUSTOMER = user();
const OTHER_CUSTOMER = user({ userId: "user-other-customer", email: "other@example.ca" });
const VENDOR_STAFF = user({
  userId: "user-vendor",
  email: "vendor@example.ca",
  roles: ["vendor"],
  activeRole: "vendor",
  vendorIds: ["vendor-bloom"],
});
const OTHER_VENDOR_STAFF = user({
  userId: "user-other-vendor",
  email: "othervendor@example.ca",
  roles: ["vendor"],
  activeRole: "vendor",
  vendorIds: ["vendor-lens"],
});
const ADMIN = user({
  userId: "user-admin",
  email: "admin@occasion.test",
  roles: ["admin"],
  activeRole: "admin",
});
/** An admin who has switched their view to a customer chip. Still an admin. */
const ADMIN_AS_CUSTOMER = user({
  userId: "user-admin",
  email: "admin@occasion.test",
  roles: ["admin", "customer"],
  activeRole: "customer",
});

const SUSPENDED_ADMIN = user({
  userId: "user-admin",
  email: "admin@occasion.test",
  roles: ["admin"],
  activeRole: "admin",
  status: "suspended",
});
const SUSPENDED_CUSTOMER = user({ status: "suspended" });
const UNVERIFIED_CUSTOMER = user({ status: "unverified" });

const ORDER = { id: "order-4192", userId: "user-customer", vendorId: "vendor-bloom" };

describe("order policies", () => {
  const readCases: Array<[string, Actor, boolean]> = [
    ["anonymous", ANONYMOUS, false],
    ["the customer who placed it", CUSTOMER, true],
    ["a different customer", OTHER_CUSTOMER, false],
    ["staff at the vendor fulfilling it", VENDOR_STAFF, true],
    ["staff at a different vendor", OTHER_VENDOR_STAFF, false],
    ["an admin", ADMIN, true],
    ["an admin browsing as a customer", ADMIN_AS_CUSTOMER, true],
    ["a suspended admin", SUSPENDED_ADMIN, false],
    ["the suspended customer who placed it", SUSPENDED_CUSTOMER, false],
    ["an unverified customer", UNVERIFIED_CUSTOMER, false],
  ];

  for (const [label, actor, allowed] of readCases) {
    it(`${allowed ? "allows" : "refuses"} ${label} to read an order`, () => {
      if (allowed) {
        expect(() => assertCanReadOrder(actor, ORDER)).not.toThrow();
      } else {
        expect(() => assertCanReadOrder(actor, ORDER)).toThrow(NotFoundError);
      }
    });
  }

  it("does not confirm the order exists when refusing", () => {
    // "Not permitted" would tell a stranger that order-4192 is real. The same
    // answer for an absent row and a row that is not theirs is the point.
    expect(() => assertCanReadOrder(OTHER_VENDOR_STAFF, ORDER)).toThrow(/No such order/);
  });

  it("lets the fulfilling vendor act, but not the customer who placed it", () => {
    expect(() => assertCanActOnOrder(VENDOR_STAFF, ORDER)).not.toThrow();
    expect(() => assertCanActOnOrder(CUSTOMER, ORDER)).toThrow(NotFoundError);
    expect(() => assertCanActOnOrder(ADMIN, ORDER)).not.toThrow();
  });
});

describe("account status", () => {
  it("refuses a suspended admin every policy", () => {
    // The role gate checks status, but policies are reachable on their own and
    // the documented rule is "every entity-id function calls a policy". If they
    // did not check, a suspended administrator would keep everything.
    expect(() => assertCanReadOrder(SUSPENDED_ADMIN, ORDER)).toThrow(NotFoundError);
    expect(() => assertCanActOnOrder(SUSPENDED_ADMIN, ORDER)).toThrow(NotFoundError);
    expect(() => assertCanActOnVendor(SUSPENDED_ADMIN, { id: "vendor-bloom" })).toThrow(
      NotFoundError,
    );
    expect(() => assertCanReadUser(SUSPENDED_ADMIN, { id: "user-customer" })).toThrow(
      NotFoundError,
    );
    expect(() => assertCanActOnUser(SUSPENDED_ADMIN, { id: "user-customer" })).toThrow(
      NotFoundError,
    );
  });

  it("refuses an unverified account its own order", () => {
    expect(() => assertCanReadOrder(UNVERIFIED_CUSTOMER, ORDER)).toThrow(NotFoundError);
  });
});

describe("vendor policies", () => {
  it("refuses one vendor the private view of another", () => {
    expect(() => assertCanReadVendorPrivately(VENDOR_STAFF, { id: "vendor-bloom" })).not.toThrow();
    expect(() => assertCanReadVendorPrivately(VENDOR_STAFF, { id: "vendor-lens" })).toThrow(
      NotFoundError,
    );
  });

  it("lets only an admin change a vendor's standing", () => {
    expect(() => assertCanActOnVendor(ADMIN, { id: "vendor-bloom" })).not.toThrow();
    // A vendor approving themselves would make the approval queue decorative.
    expect(() => assertCanActOnVendor(VENDOR_STAFF, { id: "vendor-bloom" })).toThrow(NotFoundError);
    expect(() => assertCanActOnVendor(ANONYMOUS, { id: "vendor-bloom" })).toThrow(NotFoundError);
  });
});

describe("user policies", () => {
  it("lets a person read themselves and nobody else", () => {
    expect(() => assertCanReadUser(CUSTOMER, { id: "user-customer" })).not.toThrow();
    expect(() => assertCanReadUser(CUSTOMER, { id: "user-other-customer" })).toThrow(NotFoundError);
    expect(() => assertCanReadUser(ADMIN, { id: "user-customer" })).not.toThrow();
  });

  it("refuses an admin acting on their own account", () => {
    // Suspending yourself, or revoking your own admin role, can leave the
    // platform with no administrator and no way back in.
    expect(() => assertCanActOnUser(ADMIN, { id: "user-admin" })).toThrow(NotFoundError);
    expect(() => assertCanActOnUser(ADMIN, { id: "user-customer" })).not.toThrow();
  });

  it("refuses a customer acting on anyone", () => {
    expect(() => assertCanActOnUser(CUSTOMER, { id: "user-other-customer" })).toThrow(
      NotFoundError,
    );
  });
});

describe("event policies", () => {
  const EVENT = { id: "event-1", ownerUserId: "user-customer" };

  it("lets an admin read a customer's event", () => {
    // Deliberate, and the reason the two event policies are different
    // functions: an administrator looking at a booking's event on an admin
    // screen is legitimate.
    expect(() => assertCanReadEvent(ADMIN, EVENT)).not.toThrow();
    expect(() => assertCanReadEvent(CUSTOMER, EVENT)).not.toThrow();
    expect(() => assertCanReadEvent(OTHER_CUSTOMER, EVENT)).toThrow(NotFoundError);
  });

  it("lets only the owner act on an event", () => {
    expect(() => assertCanActOnEvent(CUSTOMER, EVENT)).not.toThrow();
    expect(() => assertCanActOnEvent(OTHER_CUSTOMER, EVENT)).toThrow(NotFoundError);
    expect(() => assertCanActOnEvent(ANONYMOUS, EVENT)).toThrow(NotFoundError);
  });

  it("refuses an administrator, however they are presenting themselves", () => {
    // Acting on an event books against it and takes a card. An administrator
    // doing that puts a person on the audit trail who cannot explain the
    // charge — and the customer-chip view is the same authority wearing a
    // different label, so it is refused too.
    expect(() => assertCanActOnEvent(ADMIN, EVENT)).toThrow(NotFoundError);
    expect(() => assertCanActOnEvent(ADMIN_AS_CUSTOMER, EVENT)).toThrow(NotFoundError);
  });

  it("refuses an administrator their own event as well", () => {
    // Ownership is not the escape hatch: the refusal is about what the actor
    // holds, not whose row it is, so a held admin role refuses regardless.
    expect(() => assertCanActOnEvent(ADMIN, { id: "event-2", ownerUserId: "user-admin" })).toThrow(
      NotFoundError,
    );
  });

  it("refuses the platform's own principal", () => {
    // The three order policies admit `SYSTEM` because the job runner charges
    // money on bookings that exist. Nothing it does begins one.
    expect(() => assertCanActOnEvent(SYSTEM, EVENT)).toThrow(NotFoundError);
    expect(() => assertCanReadEvent(SYSTEM, EVENT)).toThrow(NotFoundError);
  });

  it("refuses an account that may not act at all", () => {
    expect(() => assertCanActOnEvent(SUSPENDED_CUSTOMER, EVENT)).toThrow(NotFoundError);
    expect(() => assertCanActOnEvent(UNVERIFIED_CUSTOMER, EVENT)).toThrow(NotFoundError);
  });
});
