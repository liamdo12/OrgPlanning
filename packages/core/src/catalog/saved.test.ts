import { describe, expect, it } from "vitest";
import type { CoreContext } from "../context.js";
import { NotFoundError, UnauthenticatedError } from "../errors.js";
import { ANONYMOUS, SYSTEM, type Actor } from "../identity/actor.js";
import { listSaved, toggleSaved } from "./saved.js";

/**
 * Who is turned away before a query is issued.
 *
 * What a shortlist contains is asserted against real rows in
 * `catalog-discovery.test.ts`. What that cannot show is *when* the refusal
 * happens: a check written after the read still returns the right error, and
 * still hands an unusable caller's id to the database on every request. The
 * context here has a `db` that throws, so anything reaching it fails loudly
 * instead of passing.
 */

/** A context whose database refuses to be used. Touching it is the failure. */
const unreachable = {
  get db(): never {
    throw new Error("the refusal has to land before the query");
  },
} as unknown as CoreContext;

const SERVICE_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

const suspended: Actor = {
  kind: "user",
  userId: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  email: "bea@terracerentals.ca",
  status: "suspended",
  roles: ["vendor"],
  activeRole: "vendor",
  vendorIds: [],
};

const pending: Actor = { ...suspended, status: "pending" };

describe("saving a service", () => {
  it("tells an anonymous visitor to sign in rather than refusing them", async () => {
    // Nothing is wrong with the request; it needs somebody to belong to. A
    // caller that could not tell the two apart would draw an error beside the
    // heart instead of offering the sign-in the person actually needs.
    await expect(toggleSaved(unreachable, ANONYMOUS, SERVICE_ID)).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
  });

  it("refuses the platform's own principal", async () => {
    // A shortlist belongs to a person. The job runner has no shortlist, and a
    // skeleton key that could write one would be a way for scheduled work to
    // write rows against an account.
    await expect(toggleSaved(unreachable, SYSTEM, SERVICE_ID)).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
  });

  it.each([
    ["suspended", suspended],
    ["pending", pending],
  ])("refuses a %s account without confirming the service exists", async (_name, actor) => {
    // `NotFoundError`, not `ForbiddenError`, and the same message an unknown id
    // gets: a refusal that distinguished the two would answer "does this id
    // exist" for anybody holding a suspended account.
    await expect(toggleSaved(unreachable, actor, SERVICE_ID)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("reading a shortlist", () => {
  it.each([
    ["anonymous", ANONYMOUS],
    ["the platform's own principal", SYSTEM],
    ["a suspended account", suspended],
  ])("is empty for %s, and asks the database nothing", async (_name, actor) => {
    // Empty rather than an error: a signed-out home screen draws an empty
    // shortlist, it does not fall over.
    await expect(listSaved(unreachable, actor)).resolves.toEqual([]);
  });
});
