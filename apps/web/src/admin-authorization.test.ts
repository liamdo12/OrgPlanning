import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

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
 */

const appRoot = fileURLToPath(new URL("..", import.meta.url));
const adminRoot = join(appRoot, "src/app/(admin)");

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

function parse(path: string): ts.SourceFile {
  return ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.ESNext,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function isExported(node: ts.FunctionDeclaration | ts.VariableStatement): boolean {
  return node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) === true;
}

/**
 * Every exported function in a file, however it was written.
 *
 * Both shapes, because the rule is about what a browser can POST to and not
 * about syntax: `export const approveThing = async () => {…}` is as much a
 * server action as `export async function approveThing() {…}`, and a check that
 * only walked declarations would let the arrow form in ungated while the count
 * below still looked healthy.
 */
function exportedFunctions(source: ts.SourceFile): Array<{ name: string; body?: ts.Block }> {
  const found: Array<{ name: string; body?: ts.Block }> = [];

  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && isExported(statement)) {
      found.push({
        name: statement.name?.getText() ?? "(anonymous)",
        ...(statement.body ? { body: statement.body } : {}),
      });
      continue;
    }

    if (!ts.isVariableStatement(statement) || !isExported(statement)) continue;

    for (const declaration of statement.declarationList.declarations) {
      const initialiser = declaration.initializer;
      if (!initialiser) continue;
      if (!ts.isArrowFunction(initialiser) && !ts.isFunctionExpression(initialiser)) continue;

      found.push({
        name: declaration.name.getText(),
        ...(ts.isBlock(initialiser.body) ? { body: initialiser.body } : {}),
      });
    }
  }

  return found;
}

/** The text of a function's first statement, or "" when it has no body. */
function firstStatement(body: ts.Block | undefined): string {
  const statement = body?.statements[0];
  return statement ? statement.getText() : "";
}

/**
 * A route file, as Next.js decides it.
 *
 * A directory whose name begins with `_` is private: Next does not route to
 * anything inside it, so `_components/admin-page.tsx` is a component that
 * happens to be named like a page. Matching on the basename alone would put it
 * in front of a gate it has no business holding.
 */
function isRouteFile(path: string, basename: string): boolean {
  const parts = relative(adminRoot, path).split("/");
  return parts[parts.length - 1] === basename && !parts.some((part) => part.startsWith("_"));
}

const adminFiles = walk(adminRoot);
const pages = adminFiles.filter((path) => isRouteFile(path, "page.tsx"));
const actionFiles = adminFiles.filter((path) => isRouteFile(path, "actions.ts"));

/** Named so a failure says which screen, not which absolute path. */
const label = (path: string) => relative(appRoot, path);

describe("admin pages", () => {
  it("finds the screens", () => {
    // A walker pointed at the wrong directory would make every case below
    // vacuous, and a passing suite is exactly what that would look like.
    expect(pages.length).toBeGreaterThanOrEqual(5);
  });

  it.each(pages.map((path) => [label(path), path] as const))(
    "%s gates itself with requireAdminPage as its first statement",
    (_name, path) => {
      const source = parse(path);
      const exported = source.statements.find(
        (statement): statement is ts.FunctionDeclaration =>
          ts.isFunctionDeclaration(statement) &&
          statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword) === true,
      );

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
  const actions = actionFiles.flatMap((path) =>
    exportedFunctions(parse(path)).map((fn) => ({
      name: `${label(path)}#${fn.name}`,
      first: firstStatement(fn.body),
    })),
  );

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
    for (const path of actionFiles) {
      expect(readFileSync(path, "utf8").startsWith('"use server"')).toBe(true);
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
};

describe("route handlers", () => {
  // Every `route.ts` anywhere under `src/app`, not only the two trees the
  // registry happens to name. A handler added inside `(admin)` would otherwise
  // be checked by nothing at all: the page and action walkers do not look at
  // `route.ts`, and a registry keyed on two directories would not see it.
  const handlers = walk(join(appRoot, "src/app"))
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
    expect(readFileSync(join(appRoot, path), "utf8")).toContain(gate);
  });
});
