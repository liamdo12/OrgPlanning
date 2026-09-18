import { describe, expect, it } from "vitest";
import { ValidationError } from "../errors.js";
import {
  VENDOR_STATUSES,
  assertTransition,
  canTransition,
  capabilityEndsOnEntering,
  parseVendorStatus,
  payoutAllowed,
  payoutsStopOnEntering,
  publiclyListable,
  reasonRequiredOnEntering,
  type VendorStatus,
} from "./transitions.js";

/**
 * The whole table, asserted rather than described.
 *
 * Written as "every pair, and these are the legal ones" instead of a list of
 * the legal ones, so adding a state to the enum without deciding what it may
 * become fails here rather than defaulting to permitted.
 */

const LEGAL: ReadonlyArray<[VendorStatus, VendorStatus]> = [
  ["pending", "approved"],
  ["pending", "blocked"],
  ["approved", "suspended"],
  ["suspended", "approved"],
  ["blocked", "pending"],
  ["blocked", "approved"],
];

function isLegal(from: VendorStatus, to: VendorStatus): boolean {
  return LEGAL.some(([a, b]) => a === from && b === to);
}

describe("vendor transitions", () => {
  it("permits exactly the documented moves and no others", () => {
    for (const from of VENDOR_STATUSES) {
      for (const to of VENDOR_STATUSES) {
        expect(
          canTransition(from, to),
          `${from} → ${to} should be ${isLegal(from, to) ? "legal" : "refused"}`,
        ).toBe(isLegal(from, to));
      }
    }
  });

  it("refuses a move that would skip the queue", () => {
    // The two that matter: a suspended business cannot be quietly blocked
    // without going through reinstatement, and an approved one cannot be
    // dropped back into the queue as though it had never been cleared.
    expect(canTransition("suspended", "blocked")).toBe(false);
    expect(canTransition("approved", "pending")).toBe(false);
  });

  it("names the states in the message it throws", () => {
    expect(() => assertTransition("approved", "pending")).toThrow(ValidationError);
    expect(() => assertTransition("approved", "pending")).toThrow(/approved vendor cannot become/);
  });

  it("refuses a move to the state the vendor is already in", () => {
    // Not merely redundant: an idempotent-looking approve would write a second
    // audit row and re-run the effects of a status change that did not happen.
    for (const status of VENDOR_STATUSES) {
      expect(() => assertTransition(status, status)).toThrow(/already/);
    }
  });

  it("pays only an approved vendor", () => {
    expect(payoutAllowed("approved")).toBe(true);
    for (const status of VENDOR_STATUSES.filter((s) => s !== "approved")) {
      expect(payoutAllowed(status), status).toBe(false);
    }
  });

  it("stops scheduled money on the way into every state but approved", () => {
    expect(payoutsStopOnEntering("approved")).toBe(false);
    expect(payoutsStopOnEntering("suspended")).toBe(true);
    expect(payoutsStopOnEntering("blocked")).toBe(true);
    // A vendor sent back for review has not been cleared to be paid either.
    expect(payoutsStopOnEntering("pending")).toBe(true);
  });

  it("ends staff sessions on suspension and blocking, but not in the queue", () => {
    expect(capabilityEndsOnEntering("suspended")).toBe(true);
    expect(capabilityEndsOnEntering("blocked")).toBe(true);
    // Staff of a business awaiting approval are still setting it up.
    expect(capabilityEndsOnEntering("pending")).toBe(false);
    expect(capabilityEndsOnEntering("approved")).toBe(false);
  });

  it("requires a reason for the two moves that take something away", () => {
    expect(reasonRequiredOnEntering("suspended")).toBe(true);
    expect(reasonRequiredOnEntering("blocked")).toBe(true);
    expect(reasonRequiredOnEntering("approved")).toBe(false);
    expect(reasonRequiredOnEntering("pending")).toBe(false);
  });

  it("lists only an approved vendor publicly", () => {
    expect(publiclyListable("approved")).toBe(true);
    expect(publiclyListable("suspended")).toBe(false);
    expect(publiclyListable("pending")).toBe(false);
    expect(publiclyListable("blocked")).toBe(false);
  });

  it("refuses text that is not a status", () => {
    expect(parseVendorStatus("approved")).toBe("approved");
    expect(() => parseVendorStatus("under_review")).toThrow(ValidationError);
    expect(() => parseVendorStatus(undefined)).toThrow(ValidationError);
    expect(() => parseVendorStatus(["approved"])).toThrow(ValidationError);
  });
});
