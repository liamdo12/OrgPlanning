import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  APP_ROOT,
  actionsUnder,
  defaultExportedFunction,
  firstStatement,
  label,
  pagesUnder,
  parse,
  walk,
} from "./authorization-registry.js";

/**
 * Every admin surface gates itself, and the gate is the first thing it does.
 *
 * A Next.js layout is not a security boundary. It does not run for a server
 * action, it does not run for a route handler, and it does not re-run on a
 * client-side navigation between its own segments — so `(admin)/layout.tsx`
 * redirects for the sake of the person browsing and decides nothing. What
 * decides is `requireAdminPage()` in each page and `requireAdminActor()` in
 * each action, and the reason that rule is asserted here rather than reviewed
 * is that the failure is a missing line: a new screen that reads well, renders
 * correctly for the administrator who wrote it, and is open to everybody.
 *
 * The files come from walking the tree rather than from a list, so a screen
 * added next week is in scope the moment it exists. "First statement" is meant
 * literally — a gate below a database read has already leaked the row it was
 * meant to protect.
 *
 * The walker itself is shared with the customer registry. A second copy would
 * be a second thing to teach about a syntax it has not seen.
 */

const adminRoot = join(APP_ROOT, "src/app/(admin)");

const pages = pagesUnder(adminRoot);

describe("admin pages", () => {
  it("finds the screens", () => {
    // A walker pointed at the wrong directory would make every case below
    // vacuous, and a passing suite is exactly what that would look like.
    expect(pages.length).toBeGreaterThanOrEqual(5);
  });

  it.each(pages.map((path) => [label(path), path] as const))(
    "%s gates itself with requireAdminPage as its first statement",
    (_name, path) => {
      const exported = defaultExportedFunction(parse(path));

      expect(exported, `${label(path)} has no default-exported page function`).toBeDefined();
      expect(firstStatement(exported?.body)).toContain("requireAdminPage()");
    },
  );

  it.each(pages.map((path) => [label(path), path] as const))(
    "%s does not use the action gate, which throws where a page should redirect",
    (_name, path) => {
      // Same decision, different answer to a refusal. A page that throws logs
      // an exception for every anonymous visitor and renders the error
      // boundary, when what should happen is the login screen.
      expect(readFileSync(path, "utf8")).not.toContain("requireAdminActor");
    },
  );
});

describe("admin server actions", () => {
  const actions = actionsUnder(adminRoot);

  it("finds the actions", () => {
    expect(actions.length).toBeGreaterThanOrEqual(20);
  });

  it.each(actions.map((action) => [action.name, action] as const))(
    "%s gates itself with requireAdminActor as its first statement",
    (_name, action) => {
      expect(action.first).toContain("requireAdminActor()");
    },
  );

  it("marks every action file as server-only", () => {
    // Without the directive these are ordinary exported functions, and the
    // gate inside them is a function call a client bundle would simply not make.
    for (const path of walk(adminRoot).filter((file) => file.endsWith("actions.ts"))) {
      expect(readFileSync(path, "utf8").startsWith('"use server"'), label(path)).toBe(true);
    }
  });
});

/**
 * Route handlers are not admin surfaces and do not share one gate.
 *
 * A webhook is authenticated by its signature and a cron endpoint by a shared
 * secret, so each is listed with the thing that stands in for a session. The
 * registry is checked for completeness both ways: a new handler with no entry
 * fails, and an entry naming a handler that has been deleted fails too.
 */
const ROUTE_GATES: Readonly<Record<string, string>> = {
  "src/app/api/jobs/tick/route.ts": "env.JOBS_TICK_SECRET",
  "src/app/api/webhooks/stripe/route.ts": "ctx.stripe.parseWebhook",
  "src/app/api/webhooks/email/route.ts": "timingSafeEqual",
  "src/app/(auth)/auth-callback/route.ts": "verifyOtp",
  // The one handler with an ordinary session behind it. It serves a customer
  // their own booking as a calendar file, so the gate is the customer gate and
  // the order's own read policy behind it.
  "src/app/(customer)/orders/[orderId]/calendar/route.ts": "requireCustomerActor()",
};

describe("route handlers", () => {
  // Every `route.ts` anywhere under `src/app`, not only the two trees the
  // registry happens to name. A handler added inside `(admin)` would otherwise
  // be checked by nothing at all: the page and action walkers do not look at
  // `route.ts`, and a registry keyed on two directories would not see it.
  const handlers = walk(join(APP_ROOT, "src/app"))
    .filter((path) => path.endsWith("route.ts"))
    .map(label);

  it("lists every handler", () => {
    expect(handlers.length).toBeGreaterThan(0);
    expect([...handlers].sort()).toEqual(Object.keys(ROUTE_GATES).sort());
  });

  it("has none inside the admin group, which has no gate of its own for them", () => {
    // If one is ever added it needs `requireAdminActor()` as its first
    // statement and a case of its own here, exactly as an action does. Failing
    // at that point is how the conversation starts.
    expect(handlers.filter((path) => path.includes("(admin)"))).toEqual([]);
  });

  it.each(Object.entries(ROUTE_GATES))("%s checks %s before it acts", (path, gate) => {
    expect(readFileSync(join(APP_ROOT, path), "utf8")).toContain(gate);
  });
});
