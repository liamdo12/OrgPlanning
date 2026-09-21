import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/**
 * The walker both route registries are built on.
 *
 * One implementation rather than one per route group, because the failure the
 * registries exist to catch is a *missing line* — and a registry that has been
 * copied is one where the copy quietly stops at a syntax the original learned
 * about. The arrow-function form of a server action is the example: a walker
 * that only looked at declarations would let `export const approveThing =
 * async () => {}` through while its count still looked healthy.
 *
 * Nothing here decides anything. It reports what is in the tree; each group's
 * own suite says what must be true of it.
 */

export const APP_ROOT = fileURLToPath(new URL("..", import.meta.url));

export function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

/** Named so a failure says which screen, not which absolute path. */
export function label(path: string): string {
  return relative(APP_ROOT, path);
}

export function parse(path: string): ts.SourceFile {
  return ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.ESNext,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

/**
 * A route file, as Next.js decides it.
 *
 * A directory whose name begins with `_` is private: Next does not route to
 * anything inside it, so `_components/customer-shell.tsx` is a component that
 * happens to live near pages. Matching on the basename alone would put it in
 * front of a gate it has no business holding.
 */
export function isRouteFile(root: string, path: string, basename: string): boolean {
  const parts = relative(root, path).split("/");
  return parts[parts.length - 1] === basename && !parts.some((part) => part.startsWith("_"));
}

/** Every `page.tsx` under a route group, private directories excluded. */
export function pagesUnder(root: string): string[] {
  return walk(root).filter((path) => isRouteFile(root, path, "page.tsx"));
}

/** Every `actions.ts` under a route group, private directories excluded. */
export function actionFilesUnder(root: string): string[] {
  return walk(root).filter((path) => isRouteFile(root, path, "actions.ts"));
}

function isExported(node: ts.FunctionDeclaration | ts.VariableStatement): boolean {
  return node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) === true;
}

/**
 * Every exported function in a file, however it was written.
 *
 * Both shapes, because the rule is about what a browser can POST to and not
 * about syntax: `export const approveThing = async () => {…}` is as much a
 * server action as `export async function approveThing() {…}`.
 */
export function exportedFunctions(source: ts.SourceFile): Array<{ name: string; body?: ts.Block }> {
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
export function firstStatement(body: ts.Block | undefined): string {
  const statement = body?.statements[0];
  return statement ? statement.getText() : "";
}

/** The default-exported function of a page file, if it has one. */
export function defaultExportedFunction(source: ts.SourceFile): ts.FunctionDeclaration | undefined {
  return source.statements.find(
    (statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) &&
      statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword) ===
        true,
  );
}

/** Every exported action in a group, as `file#name` with its first statement. */
export function actionsUnder(root: string): Array<{ name: string; first: string }> {
  return actionFilesUnder(root).flatMap((path) =>
    exportedFunctions(parse(path)).map((fn) => ({
      name: `${label(path)}#${fn.name}`,
      first: firstStatement(fn.body),
    })),
  );
}
