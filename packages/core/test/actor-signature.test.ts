import { describe, expect, it } from "vitest";
import {
  entityIds,
  exportedFunctions,
  namesEntityId,
  takesActor,
  type ExportedFunction,
} from "./surface.js";

/**
 * Nothing on the barrel may take an entity id and no actor.
 *
 * The second authorization layer only works if every way into a row goes past
 * it. A role gate says "an administrator may use this"; a policy says "this
 * administrator may touch that row", and the policy cannot run in a function
 * that was never told who is asking. Reviewing for that by eye is how one
 * vendor eventually reads another's order: the omission is a missing parameter,
 * which is exactly the kind of thing a diff makes look smaller than it is.
 *
 * So the rule is mechanical and the exceptions are written down. A new export
 * either takes an actor or names itself here with a reason somebody else can
 * disagree with.
 */

/**
 * Why a function may hold an entity id without an actor.
 *
 * Categories rather than free text, because a reason that fits none of these is
 * a reason worth arguing about before the export lands.
 */
const GROUNDS = {
  /** Authority arrives in a single-use token; there is no session to read. */
  token: "token-bearing",
  /** The caller is a provider webhook whose signature has been verified. */
  provider: "provider-authenticated",
  /** Below the service layer: takes a db handle, and its callers hold the actor. */
  repository: "repository",
  /** Asserts a condition inside a path whose caller has already been authorized. */
  invariant: "internal-invariant",
  /** The id names who did something, not what is being read or changed. */
  provenance: "provenance-only",
  /** Touches no data at all. */
  pure: "pure",
} as const;

type Ground = (typeof GROUNDS)[keyof typeof GROUNDS];

const EXEMPT: Readonly<Record<string, { ground: Ground; because: string }>> = {
  acceptAdminInvite: {
    ground: GROUNDS.token,
    because:
      "The invite token is the authority. `acceptingUserId` is the caller's own id, taken from the session that has just signed in, and the function refuses a token that names a different address.",
  },
  assertVendorMayBePaid: {
    ground: GROUNDS.invariant,
    because:
      "A payout-time check that takes the transaction's `DbExecutor`, not the context. It runs inside `transferShare`, which has already put the actor past a policy; its job is to stop money reaching a blocked vendor, not to decide who asked.",
  },
  confirmFromWebhook: {
    ground: GROUNDS.provider,
    because:
      "The ids are Stripe's and arrive on an event whose signature the route has verified. There is no actor on a webhook, and inventing one would put a person on an audit trail who was asleep.",
  },
  describeScope: {
    ground: GROUNDS.pure,
    because: "Formats a sentence from an audience and a count. It reads nothing.",
  },
  endVendorStaffSessions: {
    ground: GROUNDS.invariant,
    because:
      "The second half of suspending a vendor, run in the same transaction as the status change. It moves `sessions_valid_after` forward and reads no row on anybody's behalf.",
  },
  markEmailVerified: {
    ground: GROUNDS.invariant,
    because:
      "A write with no read of its own. Its two callers are the auth callback, reconciling the account that has just proved its own address, and the admin resend path immediately after `resendVerification` has run its policy on the same id.",
  },
  markWebhookFailed: {
    ground: GROUNDS.repository,
    because:
      "Takes a `DbExecutor` and marks one received event as having thrown. The id is a row in our own webhook table, not an entity anybody owns, and the only caller is the sweep.",
  },
  markWebhookProcessed: {
    ground: GROUNDS.repository,
    because:
      "The other half of the sweep's bookkeeping, on the same db handle and the same table. Nothing about a person is reachable through it.",
  },
  previewNow: {
    ground: GROUNDS.provenance,
    because:
      "`override.actorUserId` says which administrator set the override being previewed. The override itself was read for that administrator.",
  },
  readOverride: {
    ground: GROUNDS.provenance,
    because:
      "Reads an override by the id of the administrator who set it. Both callers pass `actor.userId`, so the id is the caller's own; an override is per-person by construction and names nobody else.",
  },
  recordEmailDeliveryEvent: {
    ground: GROUNDS.provider,
    because:
      "The id is the provider's message id, arriving on a Svix-signed webhook. Same shape as the Stripe one.",
  },
  recordWebhook: {
    ground: GROUNDS.repository,
    because:
      "Writes the event the route has just verified, keyed by the provider's event id so a redelivery is recognised. The route is the authority; this is where it puts what it received.",
  },
  runDueJobs: {
    ground: GROUNDS.provenance,
    because:
      "`triggeredByUserId` and `overrideActorId` are what the run records about itself. The runner acts as `SYSTEM`; what it may touch is decided per job by the demo flag, not by these.",
  },
  vendorIdForStripeAccount: {
    ground: GROUNDS.repository,
    because: "Resolves a provider account id to a vendor on a db handle, for the webhook route.",
  },
};

describe("every export that takes an entity id takes an actor", () => {
  const surface = exportedFunctions();

  it("finds the barrel", () => {
    // A reflection bug that returned nothing would make every assertion below
    // pass by describing an empty world.
    expect(surface.length).toBeGreaterThan(100);
    expect(surface.map((fn) => fn.name)).toContain("getOrderDetail");
  });

  it("refuses an unguarded signature", () => {
    const unguarded = surface
      .filter((fn) => entityIds(fn).length > 0 && !takesActor(fn) && !EXEMPT[fn.name])
      .map((fn) => `${fn.name} (${fn.file}) takes ${entityIds(fn).join(", ")} and no actor`);

    expect(unguarded).toEqual([]);
  });

  it("keeps the exemptions honest", () => {
    // An exemption that no longer describes anything is worse than no
    // exemption: it reads as a decision somebody made about the code as it is.
    const stale = Object.keys(EXEMPT).filter((name) => {
      const fn = surface.find((candidate) => candidate.name === name);
      return !fn || entityIds(fn).length === 0 || takesActor(fn);
    });

    expect(stale).toEqual([]);
  });

  it("gives every exemption a reason of its own", () => {
    for (const [name, { because }] of Object.entries(EXEMPT)) {
      expect(because.length, `${name} needs a reason`).toBeGreaterThan(40);
    }
  });
});

describe("what counts as an entity id", () => {
  // The detector is the whole test, so the cases it must and must not catch are
  // spelled out rather than trusted. A pattern loose enough to match `paid`
  // would drown the exemption list; one tight enough to miss `targetUserId`
  // would pass the day somebody adds it.
  it.each(["id", "ids", "userId", "targetUserId", "orderId", "userIds", "acceptingUserId"])(
    "catches %s",
    (name) => {
      expect(namesEntityId(name)).toBe(true);
    },
  );

  it.each(["paid", "valid", "void", "identity", "idempotencyKey", "invalid"])(
    "leaves %s alone",
    (name) => {
      expect(namesEntityId(name)).toBe(false);
    },
  );

  it("would refuse a new unguarded export", () => {
    // The rule as it applies to a function nobody has written yet. Asserting
    // it against the barrel alone only proves today's exports pass; this is the
    // shape the check exists to catch tomorrow.
    const invented: ExportedFunction = {
      name: "readOrderForNobody",
      file: "src/ordering/service.ts",
      params: [
        { name: "ctx", type: "CoreContext", fields: [] },
        { name: "orderId", type: "string", fields: [] },
      ],
    };

    expect(entityIds(invented)).toEqual(["orderId"]);
    expect(takesActor(invented)).toBe(false);
  });

  it("catches an id handed over inside a bag", () => {
    // A parameter object is the way past a check that only reads parameter
    // names, and the way an id-taking function usually grows a second one.
    const invented: ExportedFunction = {
      name: "refundSomething",
      file: "src/payments/service.ts",
      params: [
        { name: "ctx", type: "CoreContext", fields: [] },
        { name: "input", type: "{ orderId: string; amount: bigint }", fields: ["orderId"] },
      ],
    };

    expect(entityIds(invented)).toEqual(["input.orderId"]);
  });

  it("does not count the actor's own ids", () => {
    const guarded = exportedFunctions().find((fn) => fn.name === "listUsersForAdmin");

    // It takes an actor — which carries `userId` and `vendorIds` — and no id of
    // its own. Counting the actor's would report it as an id-taking function
    // and put it in front of the matrix below for no reason.
    expect(guarded && entityIds(guarded)).toEqual([]);
  });
});
