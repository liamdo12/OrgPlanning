import { describe, expect, it } from "vitest";
import { createTestCoreContext } from "../testing.js";
import { ForbiddenError, UnauthenticatedError } from "../errors.js";
import { ANONYMOUS, type Actor } from "../identity/actor.js";
import {
  approveVendor,
  blockVendor,
  getVendorDetail,
  listVendorsForAdmin,
  markUnderReview,
  reinstateVendor,
  suspendVendor,
} from "./service.js";

/**
 * Who may reach the vendor queue at all.
 *
 * The context these run against has **no database** — `createTestCoreContext`
 * hands out a handle that throws on first use. That is the assertion: a refusal
 * that happens before any query cannot be a refusal that leaked a row on the
 * way to deciding. If one of these ever fails with "this test context has no
 * database", the gate has moved below the query.
 */

const VENDOR_ID = "6f1d9e2c-0000-4000-8000-000000000001";

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
const VENDOR_STAFF = user({
  userId: "user-vendor",
  email: "vendor@example.ca",
  roles: ["vendor"],
  activeRole: "vendor",
  vendorIds: [VENDOR_ID],
});
const SUSPENDED_ADMIN = user({
  userId: "user-suspended-admin",
  email: "ex-admin@occasion.test",
  roles: ["admin"],
  activeRole: "admin",
  status: "suspended",
});

/** Every way in, so a new entry point without a gate has nowhere to hide. */
const ENTRY_POINTS: ReadonlyArray<[string, (actor: Actor) => Promise<unknown>]> = [
  ["listVendorsForAdmin", (actor) => listVendorsForAdmin(createTestCoreContext(), actor)],
  ["getVendorDetail", (actor) => getVendorDetail(createTestCoreContext(), actor, VENDOR_ID)],
  ["approveVendor", (actor) => approveVendor(createTestCoreContext(), actor, VENDOR_ID)],
  ["suspendVendor", (actor) => suspendVendor(createTestCoreContext(), actor, VENDOR_ID, "why")],
  ["blockVendor", (actor) => blockVendor(createTestCoreContext(), actor, VENDOR_ID, "why")],
  ["reinstateVendor", (actor) => reinstateVendor(createTestCoreContext(), actor, VENDOR_ID)],
  ["markUnderReview", (actor) => markUnderReview(createTestCoreContext(), actor, VENDOR_ID)],
];

describe("vendor queue authorization", () => {
  it.each(ENTRY_POINTS)("refuses an anonymous caller at %s", async (_name, call) => {
    await expect(call(ANONYMOUS)).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it.each(ENTRY_POINTS)("refuses a customer at %s", async (_name, call) => {
    await expect(call(CUSTOMER)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it.each(ENTRY_POINTS)("refuses vendor staff at %s", async (_name, call) => {
    // Including staff of the very vendor named in the call: belonging to a
    // business is not authority over its standing, or a vendor could approve
    // and reinstate themselves.
    await expect(call(VENDOR_STAFF)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it.each(ENTRY_POINTS)("refuses a suspended administrator at %s", async (_name, call) => {
    await expect(call(SUSPENDED_ADMIN)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses before it queries, not after", async () => {
    // The context's database throws a recognisable message on first touch. A
    // refusal that reached it would fail with that instead.
    await expect(listVendorsForAdmin(createTestCoreContext(), CUSTOMER)).rejects.not.toThrow(
      /has no database/,
    );
  });
});
