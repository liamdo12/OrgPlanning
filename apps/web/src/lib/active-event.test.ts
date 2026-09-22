import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as OccasionCore from "@occasion/core";
import type { Actor, CoreContext } from "@occasion/core";
import { APP_ROOT, exportedFunctions, parse } from "../authorization-registry.js";

/**
 * The active-event cookie: what it carries, who may write it, and who reads it.
 *
 * `server-only` throws outside a React Server Component build and `next/headers`
 * needs a request, so both are replaced. Nothing else is: the cookie options and
 * the resolver's refusals are this module's own code, and stubbing those would
 * be a test of the stub.
 */

vi.mock("server-only", () => ({}));

const store = {
  get: vi.fn<(name: string) => { value: string } | undefined>(),
  set: vi.fn(),
  delete: vi.fn(),
};

vi.mock("next/headers", () => ({ cookies: () => Promise.resolve(store) }));

const tier = { value: "local" as "local" | "preview" | "production" };
vi.mock("./env", () => ({ getEnv: () => ({ APP_TIER: tier.value }) }));

const COOKIE = "occasion.active-event";
const EVENT_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const OTHER_EVENT_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3302";
/** An id whose load fails outright, rather than being refused. */
const BROKEN_EVENT_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3303";
const SARAH_ID = "b06d5225-044b-58c1-bff8-24a6bf3c63ee";
const ADA_ID = "b06d5225-044b-58c1-bff8-24a6bf3c63ef";

/**
 * The domain read, with its database replaced and its policy left alone.
 *
 * `apps/web`'s suite has no database, so the row lookup is a fixture. What is
 * emphatically **not** replaced is `assertCanActOnEvent`: the refusals this file
 * asserts — another customer's event, an administrator's request — have to be
 * the real policy's answer, or the test passes against a mock that agrees with
 * it by construction. The end-to-end version runs in `packages/core`, where
 * there is a database.
 */
const EVENTS: Record<string, { id: string; ownerUserId: string; name: string }> = {
  [EVENT_ID]: { id: EVENT_ID, ownerUserId: SARAH_ID, name: "Sarah's 30th" },
  [OTHER_EVENT_ID]: { id: OTHER_EVENT_ID, ownerUserId: ADA_ID, name: "Okafor wedding" },
};

vi.mock("@occasion/core", async () => {
  const actual = await vi.importActual<typeof OccasionCore>("@occasion/core");

  return {
    ...actual,
    getEvent: (_ctx: CoreContext, actor: Actor, eventId: string) => {
      if (eventId === BROKEN_EVENT_ID) throw new Error("the database is down");

      const row = EVENTS[eventId];
      if (!row) throw new actual.NotFoundError("No such event.");
      actual.assertCanActOnEvent(actor, row);
      return Promise.resolve({ ...row, items: [] });
    },
  };
});

const { clearActiveEvent, resolveActiveEvent, setActiveEvent } = await import("./active-event.js");

const ctx = {} as CoreContext;

const customer: Actor = {
  kind: "user",
  userId: SARAH_ID,
  email: "sarah@example.ca",
  status: "active",
  roles: ["customer"],
  activeRole: "customer",
  vendorIds: [],
};

/** Another customer, signed in and in good standing. */
const otherCustomer: Actor = { ...customer, userId: ADA_ID, email: "ada.okafor@example.ca" };

/**
 * The identity the first draft of this file never constructed.
 *
 * An administrator is refused, and refused under both labels: the customer chip
 * is the same authority wearing a different name.
 */
const administrator: Actor = {
  ...customer,
  userId: "b06d5225-044b-58c1-bff8-24a6bf3c63e0",
  email: "admin@occasion.test",
  roles: ["admin", "customer"],
  activeRole: "admin",
};

const administratorAsCustomer: Actor = { ...administrator, activeRole: "customer" };

function cookieIs(value: string | undefined) {
  store.get.mockImplementation((name) =>
    name === COOKIE && value !== undefined ? { value } : undefined,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  tier.value = "local";
  cookieIs(undefined);
});

describe("writing the selection", () => {
  it("names the cookie to the convention the role cookie set", () => {
    // Dotted, not underscored. Two cookies of ours under two naming schemes is
    // how the third one ends up under a third.
    expect(COOKIE).toBe("occasion.active-event");
  });

  it("carries every option, not half of them", async () => {
    tier.value = "preview";
    await setActiveEvent(EVENT_ID);

    expect(store.set).toHaveBeenCalledWith(COOKIE, EVENT_ID, {
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      // Thirty days. A selection that expires with the browser session means
      // somebody comes back tomorrow to a planner that has forgotten which
      // party they were planning.
      maxAge: 60 * 60 * 24 * 30,
    });
  });

  it("requires TLS everywhere but a local machine", async () => {
    for (const [value, secure] of [
      ["local", false],
      ["preview", true],
      ["production", true],
    ] as const) {
      tier.value = value;
      await setActiveEvent(EVENT_ID);
      expect(store.set.mock.lastCall?.[2]).toMatchObject({ secure });
    }
  });

  it("forgets the selection outright rather than blanking it", async () => {
    // A cookie set to "" is still a cookie, and the next reader has to know
    // that empty means absent.
    await clearActiveEvent();
    expect(store.delete).toHaveBeenCalledWith(COOKIE);
  });
});

describe("resolving the selection", () => {
  it.each([
    ["absent", undefined],
    ["empty", ""],
    ["not an id at all", "the-okafor-wedding"],
    ["an id with a trailing character", `${EVENT_ID}x`],
    ["sql", "' or true--"],
    ["a well-formed id naming no event", "3f2504e0-4f89-41d3-9a0c-0305e82c3399"],
  ])("answers the same way when the cookie is %s", async (_name, value) => {
    cookieIs(value);
    // A forged id must be indistinguishable from no cookie, or the response
    // becomes a way to ask which ids exist.
    await expect(resolveActiveEvent(ctx, customer)).resolves.toBeUndefined();
  });

  it("resolves the owner's own event", async () => {
    cookieIs(EVENT_ID);
    await expect(resolveActiveEvent(ctx, customer)).resolves.toEqual({
      id: EVENT_ID,
      name: "Sarah's 30th",
    });
  });

  it.each([
    ["an event somebody else owns", OTHER_EVENT_ID, () => customer],
    ["a cookie naming an event they do not own", EVENT_ID, () => otherCustomer],
    ["an administrator", EVENT_ID, () => administrator],
    ["an administrator browsing as a customer", EVENT_ID, () => administratorAsCustomer],
  ])("resolves to nothing for %s", async (_name, cookie, actor) => {
    cookieIs(cookie);
    // The same answer the absent cookie gets, and the real policy's answer
    // rather than the fixture's: `assertCanActOnEvent` is not mocked.
    await expect(resolveActiveEvent(ctx, actor())).resolves.toBeUndefined();
  });

  it("lets a real fault reach the error boundary", async () => {
    // A refusal is an ordinary answer; a database that is down is not. Folding
    // the second into "no active event" would draw an outage as an empty chip
    // and nobody would hear about it.
    cookieIs(BROKEN_EVENT_ID);

    await expect(resolveActiveEvent(ctx, customer)).rejects.toThrow("the database is down");
  });

  it("does not even look at the cookie for an anonymous visitor", async () => {
    cookieIs(EVENT_ID);
    await expect(resolveActiveEvent(ctx, { kind: "anonymous" })).resolves.toBeUndefined();
    expect(store.get).not.toHaveBeenCalled();
  });

  it("does not look at it for the platform's own principal either", async () => {
    cookieIs(EVENT_ID);
    await expect(resolveActiveEvent(ctx, { kind: "system" })).resolves.toBeUndefined();
    expect(store.get).not.toHaveBeenCalled();
  });
});

/**
 * One reader, and it is the one that checks ownership.
 *
 * The risk this guards is not a bug in the module above; it is a screen three
 * phases from now reading the cookie directly and trusting the id in it. Read
 * off the source tree rather than reasoned about, so a new file is in scope the
 * moment it exists.
 */
describe("the cookie has exactly one reader", () => {
  const appRoot = fileURLToPath(new URL("../..", import.meta.url));
  const owner = "src/lib/active-event.ts";

  function walk(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      return entry.isDirectory() ? walk(path) : [path];
    });
  }

  const sources = walk(join(appRoot, "src")).filter(
    (path) => /\.(ts|tsx)$/.test(path) && !path.endsWith(".test.ts"),
  );

  it("finds the source tree", () => {
    expect(sources.length).toBeGreaterThan(20);
  });

  it("is named in no other module", () => {
    const named = sources
      .filter((path) => readFileSync(path, "utf8").includes(COOKIE))
      .map((path) => relative(appRoot, path));

    expect(named).toEqual([owner]);
  });
});

/**
 * Signing out puts the selection down with the rest of it.
 *
 * Not an authorization property — a leftover id resolves to nothing, because
 * the resolver checks who owns the event on every read. It is that a browser
 * somebody has signed out of should not still be carrying which party they
 * were planning, and the next person at that browser should not have to
 * wonder why the header knows something.
 *
 * Read off the sign-out action itself, because the failure is a line that
 * stops being there, next to a line that is.
 */
describe("signing out", () => {
  const signOut = join(APP_ROOT, "src/app/(auth)/actions.ts");

  it("forgets the selection, beside the role it already forgets", () => {
    const body = exportedFunctions(parse(signOut)).find((fn) => fn.name === "signOutAction")?.body;

    expect(body, "signOutAction is not where it was").toBeDefined();
    expect(body?.getText()).toContain("clearActiveEvent()");
    expect(body?.getText()).toContain("clearActiveRole()");
  });
});
