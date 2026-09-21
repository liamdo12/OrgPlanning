import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as Core from "@occasion/core";
import type { Actor, RoleName, UserStatus } from "@occasion/core";

/**
 * Who each gate lets through, and where it sends everyone else.
 *
 * The identity itself is assembled by `getActor`, which reads the database and
 * is covered where the database is. What is asserted here is the decision made
 * on top of it, because that decision is the difference between "this surface
 * shows you your own things" and "this surface shows you whatever you ask for"
 * — and it is a handful of conditions that would go on passing every other test
 * if one of them were dropped.
 *
 * `server-only` throws outside a React Server Component build, `next/headers`
 * needs a request, and `redirect` throws a framework signal — so those three
 * are replaced, and the redirect is caught and read. Nothing else is: the gate
 * logic is what is under test, and stubbing it would be a test of the stub.
 */

vi.mock("server-only", () => ({}));

const requestPath = { value: "/saved" as string | null };
vi.mock("next/headers", () => ({
  headers: () => Promise.resolve({ get: () => requestPath.value }),
}));

/** The real `redirect` throws so nothing after it runs; so does this. */
class Redirected extends Error {
  constructor(readonly to: string) {
    super(`redirect ${to}`);
  }
}
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Redirected(to);
  },
}));

vi.mock("./core", () => ({ createRequestContext: () => ({}) }));
vi.mock("./active-role", () => ({ readActiveRole: () => Promise.resolve(undefined) }));

const current = { actor: { kind: "anonymous" } as Actor, fails: undefined as Error | undefined };

vi.mock("@occasion/core", async (importOriginal) => ({
  ...(await importOriginal<typeof Core>()),
  getActor: () => (current.fails ? Promise.reject(current.fails) : Promise.resolve(current.actor)),
}));

const { customerViewer, requireAdminActor, requireCustomerActor, requireCustomerPage } =
  await import("./auth-guard.js");

const { ForbiddenError, UnauthenticatedError } = await import("@occasion/core");

function user(roles: readonly RoleName[], status: UserStatus = "active"): Actor {
  return {
    kind: "user",
    userId: "b06d5225-044b-58c1-bff8-24a6bf3c63ee",
    email: "someone@example.ca",
    status,
    roles,
    activeRole: roles[0] ?? "customer",
    vendorIds: [],
  };
}

/**
 * Each case gets a fresh module registry.
 *
 * `currentActor` is wrapped in React's `cache()`, which outside a render is a
 * per-module-instance memo — so without this every case after the first would
 * silently re-use the first case's identity and pass for the wrong reason.
 */
beforeEach(() => {
  vi.resetModules();
  requestPath.value = "/saved";
  current.actor = { kind: "anonymous" };
  current.fails = undefined;
});

async function gates() {
  return import("./auth-guard.js");
}

describe("the customer action gate", () => {
  it("refuses an anonymous visitor", async () => {
    current.actor = { kind: "anonymous" };
    await expect((await gates()).requireCustomerActor()).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
  });

  it("refuses the platform's own principal, which is not a person", async () => {
    current.actor = { kind: "system" };
    await expect((await gates()).requireCustomerActor()).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
  });

  it.each(["suspended", "pending", "unverified"] as const)(
    "refuses a %s account",
    async (status) => {
      current.actor = user(["customer"], status);
      await expect((await gates()).requireCustomerActor()).rejects.toBeInstanceOf(ForbiddenError);
    },
  );

  it("admits a vendor, because the gate is about standing and not about roles", async () => {
    // The point of the rule. Signup assigns exactly one self-assignable role,
    // so a vendor account does not hold `customer` — and its owner booking a
    // cake for their own party is a customer of this marketplace anyway.
    current.actor = user(["vendor"]);
    await expect((await gates()).requireCustomerActor()).resolves.toMatchObject({
      roles: ["vendor"],
    });
  });

  it("admits a customer", async () => {
    current.actor = user(["customer"]);
    await expect((await gates()).requireCustomerActor()).resolves.toMatchObject({
      roles: ["customer"],
    });
  });

  it("refuses an administrator, whatever else they hold", async () => {
    // They have their own surface, and the object policies admit them to
    // anybody's event — so an administrator here is reading a stranger's plans
    // through a screen built on the assumption that everything shown is yours.
    for (const roles of [["admin"], ["admin", "customer"], ["customer", "admin"]] as const) {
      current.actor = user(roles);
      await expect((await gates()).requireCustomerActor(), roles.join("+")).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    }
  });
});

describe("the customer page gate", () => {
  it("sends an anonymous visitor to the login screen, and back afterwards", async () => {
    current.actor = { kind: "anonymous" };
    requestPath.value = "/saved";

    await expect((await gates()).requireCustomerPage()).rejects.toThrow(
      "redirect /login?next=%2Fsaved",
    );
  });

  it("sends a suspended account to the login screen too", async () => {
    current.actor = user(["customer"], "suspended");
    await expect((await gates()).requireCustomerPage()).rejects.toThrow("redirect /login");
  });

  it("falls back to the front door when the path header is missing", async () => {
    // The proxy sets it on every matched request, and does not run for every
    // possible path. A `next` of nothing would otherwise be a redirect loop.
    current.actor = { kind: "anonymous" };
    requestPath.value = null;

    await expect((await gates()).requireCustomerPage()).rejects.toThrow("redirect /login?next=%2F");
  });

  it("refuses an off-site next, wherever it came from", async () => {
    current.actor = { kind: "anonymous" };
    requestPath.value = "//evil.example/steal";

    await expect((await gates()).requireCustomerPage()).rejects.toThrow("redirect /login?next=%2F");
  });

  it("sends an administrator to their own screens, not to a login they are past", async () => {
    current.actor = user(["admin"]);
    await expect((await gates()).requireCustomerPage()).rejects.toThrow("redirect /admin");
  });

  it("returns the account when it passes", async () => {
    current.actor = user(["customer"]);
    await expect((await gates()).requireCustomerPage()).resolves.toMatchObject({
      email: "someone@example.ca",
    });
  });
});

describe("the shell's view of who is here", () => {
  it("answers nothing for anyone the gate would refuse", async () => {
    for (const actor of [
      { kind: "anonymous" } as Actor,
      user(["customer"], "suspended"),
      user(["admin"]),
    ]) {
      current.actor = actor;
      await expect((await gates()).customerViewer()).resolves.toBeUndefined();
    }
  });

  it("answers the account for somebody the gate admits", async () => {
    current.actor = user(["vendor"]);
    await expect((await gates()).customerViewer()).resolves.toMatchObject({ roles: ["vendor"] });
  });

  it("does not swallow an error that is not a refusal", async () => {
    // Answering "signed out" to a failed query would quietly sign somebody out
    // because the database hiccupped, and the shell would look entirely fine.
    current.fails = new Error("connection lost");

    await expect((await gates()).customerViewer()).rejects.toThrow("connection lost");
  });
});

describe("the admin gate is unchanged by any of this", () => {
  it("still refuses a customer", async () => {
    current.actor = user(["customer"]);
    await expect((await gates()).requireAdminActor()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("still admits an administrator", async () => {
    current.actor = user(["admin"]);
    await expect((await gates()).requireAdminActor()).resolves.toMatchObject({ roles: ["admin"] });
  });
});

/** Referenced so the unused-import rule does not hide a typo in the names. */
void [customerViewer, requireAdminActor, requireCustomerActor, requireCustomerPage];
