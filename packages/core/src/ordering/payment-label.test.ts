import { describe, expect, it } from "vitest";
import { paymentLabel, type PaymentPosition } from "./payment-label.js";

/**
 * The five labels, and the order they are decided in.
 *
 * The precedence is the part worth testing. Any one label is a string; which
 * one wins when two apply is the rule an administrator acts on, and it is the
 * part a later change breaks silently — a refunded order reading "Paid in
 * full" looks entirely reasonable in a screenshot.
 */

const BASE: PaymentPosition = {
  total: 32_770n,
  captured: 0n,
  returned: 0n,
  balanceFailed: false,
  currency: "CAD",
};

function label(overrides: Partial<PaymentPosition>) {
  return paymentLabel({ ...BASE, ...overrides });
}

describe("payment label", () => {
  it("says nothing has been taken yet", () => {
    expect(label({})).toEqual({ kind: "unpaid", label: "Awaiting payment" });
  });

  it("names the deposit and its amount", () => {
    // Line 2723: TO-4192, C$327.70 total, "Deposit C$65.54".
    expect(label({ captured: 6_554n })).toEqual({
      kind: "deposit",
      label: "Deposit C$65.54",
    });
  });

  it("says paid in full once the whole total has been taken", () => {
    expect(label({ captured: 32_770n })).toEqual({ kind: "paid_in_full", label: "Paid in full" });
  });

  it("does not read a reduced total as still owing", () => {
    // Nothing reduces a total today. The `>=` is what stops an order that one
    // day is reduced from reading as part-paid for ever, with nothing left to
    // charge and no way off the label.
    expect(label({ captured: 40_000n }).kind).toBe("paid_in_full");
  });

  it("says the balance failed", () => {
    // Line 2726: TO-4181, deposit taken, balance declined.
    expect(label({ captured: 26_400n, total: 132_000n, balanceFailed: true })).toEqual({
      kind: "balance_failed",
      label: "Balance failed",
    });
  });

  it("says refunded once the money has gone back", () => {
    // Line 2727: TO-4171, cancelled and refunded.
    expect(label({ captured: 4_068n, returned: 4_068n, total: 20_340n })).toEqual({
      kind: "refunded",
      label: "Refunded",
    });
  });

  it("says how much came back when only part of it did", () => {
    // An administrator recording a dashboard refund names the amount, so a
    // partial one is a real row. "Refunded" alone would describe an order as
    // settled while it still holds C$150 of somebody's money.
    expect(label({ captured: 20_340n, returned: 5_340n, total: 20_340n })).toEqual({
      kind: "refunded",
      label: "Refunded C$53.40",
    });
  });

  it("puts a refund ahead of a failed balance", () => {
    // Both are true of an order whose balance declined and whose deposit was
    // then given back. Only one of them is still somebody's job.
    expect(label({ captured: 26_400n, returned: 26_400n, balanceFailed: true }).kind).toBe(
      "refunded",
    );
  });

  it("puts a refund ahead of paid in full", () => {
    expect(label({ captured: 32_770n, returned: 32_770n }).kind).toBe("refunded");
  });

  it("puts a failed balance ahead of the deposit it sits on", () => {
    // Both describe an order with part of its money taken. The failed one is
    // the one with seventy-two hours on it.
    expect(label({ captured: 6_554n, balanceFailed: true }).kind).toBe("balance_failed");
  });

  it("formats a currency that is not Canadian without pretending it is", () => {
    // Nothing sells in anything but CAD yet — a checkout refuses to mix them —
    // so this is about the day something does. Prefixing a US dollar with `C`
    // would be a lie told in a ledger.
    expect(label({ captured: 6_554n, currency: "USD" }).label).toBe("Deposit $65.54");
  });
});
