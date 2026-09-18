import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ValidationError } from "../errors.js";
import {
  ORDER_STATES,
  assertTransition,
  cancelsQueuedJobs,
  canTransition,
  capacityIn,
  isTerminal,
  jobsOnEntering,
  parseOrderState,
  payoutAllowed,
  releasesCapacity,
  retiresPaymentLinks,
  type OrderState,
} from "./transitions.js";

/**
 * The lifecycle, asserted against the file that specifies it.
 *
 * The edges are read out of `lifecycle.md` rather than copied into this test,
 * because a copy is a third description of the lifecycle and the whole point of
 * that file is that there is one. Editing the table without editing the module
 * fails here, and so does the reverse.
 */

const lifecycle = readFileSync(fileURLToPath(new URL("./lifecycle.md", import.meta.url)), "utf8");

/** Every `a → b` line inside the fenced block that lists the moves. */
function documentedEdges(): ReadonlyArray<[OrderState, OrderState]> {
  const block = /## The moves, and only these\s+```([\s\S]*?)```/.exec(lifecycle);
  if (!block?.[1]) throw new Error("lifecycle.md no longer lists the moves in a fenced block.");

  return [...block[1].matchAll(/^(\w+)\s+→\s+(\w+)/gm)].map(([, from, to]) => [
    parseOrderState(from),
    parseOrderState(to),
  ]);
}

const EDGES = documentedEdges();

/** The ordinary booking: a deposit now and a balance later. */
const WITH_BALANCE = { hasBalance: true };
/** Paid in full at checkout — short notice, or under the small-total threshold. */
const PAID_IN_FULL = { hasBalance: false };

function isDocumented(from: OrderState, to: OrderState): boolean {
  return EDGES.some(([a, b]) => a === from && b === to);
}

describe("order transitions", () => {
  it("reads a lifecycle table that still has edges in it", () => {
    // Guards the parser above: a regex that silently matched nothing would make
    // every assertion below vacuously true.
    expect(EDGES.length).toBeGreaterThan(15);
  });

  it("permits exactly the documented moves and no others", () => {
    for (const from of ORDER_STATES) {
      for (const to of ORDER_STATES) {
        expect([from, to, canTransition(from, to)]).toEqual([from, to, isDocumented(from, to)]);
      }
    }
  });

  it("throws on every undefined transition", () => {
    for (const from of ORDER_STATES) {
      for (const to of ORDER_STATES) {
        if (isDocumented(from, to)) {
          expect(() => assertTransition(from, to)).not.toThrow();
          continue;
        }
        expect(() => assertTransition(from, to)).toThrow(ValidationError);
      }
    }
  });

  it("refuses a move to the state the order is already in", () => {
    for (const state of ORDER_STATES) {
      expect(() => assertTransition(state, state)).toThrow(/already/);
    }
  });

  it("gives every state a capacity effect matching the table", () => {
    // Transcribed from the capacity table in lifecycle.md.
    expect(ORDER_STATES.map(capacityIn)).toEqual([
      "held",
      "locked",
      "locked",
      "locked",
      "locked",
      "consumed",
      "consumed",
      "released",
      "released",
    ]);
  });

  it("releases capacity on exactly the states that end without delivery", () => {
    const releasing = ORDER_STATES.filter(releasesCapacity);
    expect(releasing).toEqual(["cancelled", "refunded"]);
    // The property that matters is the conjunction: a state that frees the slot
    // and is not an ending would free a date the booking still holds.
    for (const state of releasing) expect(isTerminal(state)).toBe(true);
  });

  it("treats completed as an ending that keeps its date", () => {
    expect(isTerminal("completed")).toBe(true);
    expect(releasesCapacity("completed")).toBe(false);
  });

  it("pays out only where the booking is alive and undisputed", () => {
    expect(ORDER_STATES.filter(payoutAllowed)).toEqual(["confirmed", "fulfilled", "completed"]);
    // `issue` is why this function exists: same capacity, same live booking, and
    // a transfer would pay out the order somebody has just disputed.
    expect(payoutAllowed("issue")).toBe(false);
  });

  it("schedules the balance and the cooling window only on a first confirmation", () => {
    const first = jobsOnEntering("pending_payment", "confirmed", WITH_BALANCE).map(
      (job) => job.type,
    );
    expect(first).toEqual(["cooling_window_transfer", "charge_balance"]);

    // The same state, reached by an order that has just paid. Re-enqueueing here
    // would schedule a second balance charge for a balance already taken.
    expect(jobsOnEntering("balance_due", "confirmed", WITH_BALANCE)).toEqual([]);
    expect(jobsOnEntering("action_required", "confirmed", WITH_BALANCE)).toEqual([]);
    expect(jobsOnEntering("issue", "confirmed", WITH_BALANCE)).toEqual([]);
  });

  it("does not schedule a balance charge for a booking that has no balance", () => {
    // Its due date is `event − 14 days`, which for a short-notice booking is
    // already in the past — so the job would be immediately due and would throw
    // every time the runner picked it up.
    const full = jobsOnEntering("pending_payment", "confirmed", PAID_IN_FULL).map(
      (job) => job.type,
    );
    expect(full).toEqual(["cooling_window_transfer"]);
  });

  it("retires an emailed link whenever the order stops waiting for one", () => {
    // However `action_required` is left: paid, cancelled at grace expiry, or
    // cancelled by an administrator.
    expect(retiresPaymentLinks("action_required", "confirmed")).toBe(true);
    expect(retiresPaymentLinks("action_required", "cancelled")).toBe(true);
    expect(retiresPaymentLinks("action_required", "issue")).toBe(true);

    // And on any ending, for a link on an order that never waited.
    for (const state of ORDER_STATES.filter(isTerminal)) {
      expect([state, retiresPaymentLinks("confirmed", state)]).toEqual([state, true]);
    }

    // Not on a move that leaves the balance still owed this way.
    expect(retiresPaymentLinks("balance_due", "action_required")).toBe(false);
    expect(retiresPaymentLinks("pending_payment", "confirmed")).toBe(false);
  });

  it("anchors each scheduled job where the lifecycle says", () => {
    expect(jobsOnEntering("confirmed", "balance_due", WITH_BALANCE)).toEqual([]);
    expect(jobsOnEntering("balance_due", "action_required", WITH_BALANCE)).toEqual([
      { type: "balance_grace_expiry", anchor: "now", offsetMinutes: 72 * 60 },
    ]);
    expect(jobsOnEntering("confirmed", "fulfilled", WITH_BALANCE)).toEqual([
      { type: "auto_complete_order", anchor: "event_end", offsetMinutes: 72 * 60 },
    ]);
    // The balance is a calendar offset, not 336 hours: across a daylight-saving
    // boundary the elapsed-time version charges on the wrong day.
    const [, balance] = jobsOnEntering("pending_payment", "confirmed", WITH_BALANCE);
    expect(balance).toEqual({ type: "charge_balance", anchor: "event_start", offsetDays: -14 });
  });

  it("cancels queued work on every ending", () => {
    for (const state of ORDER_STATES) {
      expect([state, cancelsQueuedJobs(state)]).toEqual([state, isTerminal(state)]);
    }
    expect(cancelsQueuedJobs("completed")).toBe(true);
  });

  it("refuses text that is not a state", () => {
    expect(() => parseOrderState("paid_in_full")).toThrow(ValidationError);
    expect(() => parseOrderState(undefined)).toThrow(ValidationError);
    expect(parseOrderState("action_required")).toBe("action_required");
  });
});
