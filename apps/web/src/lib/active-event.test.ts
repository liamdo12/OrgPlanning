import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor, CoreContext } from "@occasion/core";

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

const { clearActiveEvent, resolveActiveEvent, setActiveEvent } = await import("./active-event.js");

const COOKIE = "occasion.active-event";
const EVENT_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

const ctx = {} as CoreContext;

const customer: Actor = {
  kind: "user",
  userId: "b06d5225-044b-58c1-bff8-24a6bf3c63ee",
  email: "sarah@example.ca",
  status: "active",
  roles: ["customer"],
  activeRole: "customer",
  vendorIds: [],
};

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
    ["a well-formed id nobody has checked", EVENT_ID],
  ])("answers the same way when the cookie is %s", async (_name, value) => {
    cookieIs(value);
    // The point of the row above this one: a forged id must be indistinguishable
    // from no cookie, or the response becomes a way to ask which ids exist.
    await expect(resolveActiveEvent(ctx, customer)).resolves.toBeUndefined();
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
