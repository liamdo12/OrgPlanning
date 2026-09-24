import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  APP_ROOT,
  actionsUnder,
  defaultExportedFunction,
  exportedFunctions,
  firstStatement,
  isRouteFile,
  label,
  pagesUnder,
  parse,
  walk,
} from "./authorization-registry.js";

/**
 * Every customer surface gates itself, or is publicly readable on purpose.
 *
 * The same rule as the admin registry, with one addition that is the whole
 * reason this file is not a copy of it: three of these screens are **public**.
 * A walker that simply demanded a gate everywhere would fail on Explore, and
 * the fix somebody would reach for is an exception — so the exception is the
 * design. Being public is an entry on a short list with a reason beside it,
 * and a page that is neither gated nor listed fails.
 *
 * `(customer)/layout.tsx` is not the boundary and does not gate at all. It
 * cannot: it wraps the public screens too. What decides is
 * `requireCustomerPage()` in each page and `requireCustomerActor()` in each
 * action.
 *
 * Actions matter here more than they did for the admin group. This plan adds
 * screens that move money and mutate objects somebody owns, and a page-only
 * registry would leave exactly the dangerous half to review.
 */

const customerRoot = join(APP_ROOT, "src/app/(customer)");

/**
 * The screens anyone may read, and why.
 *
 * The prototype settles the set at line 2013: Explore, Results and Service
 * detail render for anybody, and every other customer route sends the visitor
 * to the login screen. Kept short and named, because "public" spreading
 * quietly is the failure this list exists to prevent — and checked in both
 * directions, so an entry for a page that has been deleted or gated fails too.
 */
const PUBLIC_PAGES: Readonly<Record<string, string>> = {
  "src/app/(customer)/page.tsx":
    "Explore is the front door; refusing a visitor here is the point of having one.",
  "src/app/(customer)/services/page.tsx":
    "Browsing what is on offer is how somebody decides to have an account.",
  "src/app/(customer)/services/[slug]/page.tsx":
    "A listing is the thing that gets shared; behind a gate it could not be.",
};

const pages = pagesUnder(customerRoot).map((path) => ({ path, name: label(path) }));

describe("customer pages", () => {
  it("finds the screens", () => {
    // A walker pointed at the wrong directory would make every case below
    // vacuous, and a passing suite is exactly what that would look like.
    expect(pages.length).toBeGreaterThanOrEqual(3);
  });

  it("has no public entry for a page that is not there", () => {
    const present = new Set(pages.map((page) => page.name));
    expect(Object.keys(PUBLIC_PAGES).filter((name) => !present.has(name))).toEqual([]);
  });

  it("keeps the public list to exactly these three routes", () => {
    // The set, not one entry at a time. Every other case reads this list as an
    // excuse — listed, therefore no gate is required — so a fourth entry with a
    // plausible sentence beside it turns a gated screen public and passes
    // everything else here. This is the only case that says what the list is
    // allowed to contain, which is why the paths are written out rather than
    // derived from the list being checked.
    expect(Object.keys(PUBLIC_PAGES).sort()).toEqual([
      "src/app/(customer)/page.tsx",
      "src/app/(customer)/services/[slug]/page.tsx",
      "src/app/(customer)/services/page.tsx",
    ]);
  });

  it.each(pages.map((page) => [page.name, page] as const))(
    "%s gates itself, or is on the public list",
    (_name, page) => {
      const exported = defaultExportedFunction(parse(page.path));
      expect(exported, `${page.name} has no default-exported page function`).toBeDefined();

      const first = firstStatement(exported?.body);
      const isPublic = page.name in PUBLIC_PAGES;

      if (isPublic) {
        // A page cannot be both. A gate on a listed page means the list is
        // stale, and a stale allowlist is one nobody trusts enough to read.
        expect(first, `${page.name} is listed as public and gates itself`).not.toContain(
          "requireCustomerPage()",
        );
        return;
      }

      expect(first).toContain("requireCustomerPage()");
    },
  );

  it.each(pages.map((page) => [page.name, page] as const))(
    "%s does not use the action gate, which throws where a page should redirect",
    (_name, page) => {
      // Next renders the layout and the page in parallel, so a layout redirect
      // does not spare the page: one that throws logs an exception for every
      // anonymous visitor and renders the error boundary.
      expect(readFileSync(page.path, "utf8")).not.toContain("requireCustomerActor");
    },
  );
});

describe("customer server actions", () => {
  const actions = actionsUnder(customerRoot);

  it("finds the actions", () => {
    expect(actions.length).toBeGreaterThanOrEqual(1);
  });

  it.each(actions.map((action) => [action.name, action] as const))(
    "%s gates itself with requireCustomerActor as its first statement",
    (_name, action) => {
      expect(action.first).toContain("requireCustomerActor()");
    },
  );

  it("marks every action file as server-only", () => {
    // Without the directive these are ordinary exported functions, and the
    // gate inside them is a call a client bundle would simply not make.
    const files = walk(customerRoot).filter((path) => path.endsWith("actions.ts"));

    expect(files.length).toBeGreaterThanOrEqual(1);
    for (const path of files) {
      expect(readFileSync(path, "utf8").startsWith('"use server"'), label(path)).toBe(true);
    }
  });

  it("keeps the directive inside the files this suite reads", () => {
    // `actionsUnder` opens `actions.ts` and nothing else, so the directive at
    // the top of a page, or inside one function of a component, is a POST
    // target every case above is blind to — and the gate it is missing would
    // not be missed by anything. There are none under this tree, which makes
    // now the one moment saying so costs nothing.
    const stray = walk(customerRoot)
      .filter((path) => !path.endsWith("actions.ts"))
      .filter((path) => readFileSync(path, "utf8").includes('"use server"'))
      .map(label);

    expect(stray).toEqual([]);
  });
});

describe("the customer layout", () => {
  const path = join(customerRoot, "layout.tsx");
  const source = readFileSync(path, "utf8");
  const body = defaultExportedFunction(parse(path))?.body?.getText() ?? "";

  it("has a default export to read", () => {
    expect(body).not.toBe("");
  });

  it("does not gate, because the public screens are inside it", () => {
    // Read from the function body rather than the file, so that naming the
    // real gate in the doc comment — which the case below requires — is not
    // itself a failure. A gate here would refuse every visitor to Explore.
    expect(body).not.toContain("requireCustomerPage()");
    expect(body).not.toContain("requireCustomerActor()");
  });

  it("says in the file where the real gate is", () => {
    expect(source).toContain("requireCustomerActor()");
    expect(source).toContain("not the security boundary");
  });
});

describe("route handlers", () => {
  const handlers = walk(customerRoot)
    .filter((path) => isRouteFile(customerRoot, path, "route.ts"))
    .map((path) => ({ path, name: label(path) }));

  it("finds the handlers", () => {
    // The calendar file is the first one in this group, and it is here rather
    // than as a server action because the result is a **file**: a handler is
    // linkable and re-downloadable, and the gate registry already walks
    // handlers, so it costs an entry rather than a new kind of surface. A
    // walker that found none would make the case below vacuous.
    expect(handlers.length).toBeGreaterThanOrEqual(1);
  });

  it.each(handlers.map((handler) => [handler.name, handler] as const))(
    "%s gates itself with requireCustomerActor as its first statement",
    (_name, handler) => {
      // A layout does not run for a route handler, so nothing else would refuse
      // an anonymous request. The admin registry separately checks that every
      // handler under `src/app` is listed in its own set, so one added here
      // cannot be invisible to both.
      const exported = exportedFunctions(parse(handler.path)).filter((fn) =>
        HTTP_METHODS.has(fn.name),
      );

      expect(exported.length, `${handler.name} exports no HTTP method`).toBeGreaterThanOrEqual(1);

      for (const method of exported) {
        expect(firstStatement(method.body), `${handler.name}#${method.name}`).toContain(
          "requireCustomerActor()",
        );
      }
    },
  );
});

/** What Next routes to in a `route.ts`. Anything else there is a helper. */
const HTTP_METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);
