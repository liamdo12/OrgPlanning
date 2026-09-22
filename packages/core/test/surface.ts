import { dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/**
 * Reflection over what `packages/core` actually exports.
 *
 * Two suites read this: `actor-signature.test.ts`, which refuses a function
 * that takes an entity id and no actor, and `authz-matrix.test.ts`, which
 * refuses one that has an actor but no exercise proving the actor is consulted.
 * They share a surface so neither can be satisfied by a registry that has
 * quietly drifted from the barrel.
 *
 * It reads the **source**, not `dist`. The claim is about the code as written:
 * a compiled signature is the same shape, but pointing the check at build
 * output makes a stale build look like a passing test.
 */

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const entry = `${packageRoot}/src/index.ts`;

export type Param = {
  name: string;
  type: string;
  /** Entity-id property names reachable one level into an object parameter. */
  fields: readonly string[];
};

export type ExportedFunction = {
  name: string;
  /** Path relative to the package root, for an error message that locates it. */
  file: string;
  params: readonly Param[];
};

/**
 * What an entity id looks like in a parameter name.
 *
 * `id`, `ids`, `reference` and `token` on their own, or a camelCase name ending
 * in one of them. The capital is what keeps `paid`, `valid` and `void` out of
 * it, and is the reason this is a pattern rather than a list somebody has to
 * remember to extend.
 *
 * A reference and a token are entity ids in every way that matters here: each
 * one names exactly one row, and a function that accepts one and no actor is a
 * way into that row with no gate on it. A booking reference is the number on
 * the receipt, and a payment link's token is the whole authority for the page
 * it opens — the fact that neither is a uuid is why they were missed, not a
 * reason they are safe.
 */
const ENTITY_ID = /^(id|ids|reference|token)$|[a-z0-9](Id|Ids|Reference|Token)$/;

export function namesEntityId(name: string): boolean {
  return ENTITY_ID.test(name);
}

/** A parameter is an actor when its type mentions the `Actor` union. */
function isActorType(type: string): boolean {
  return /\bActor\b/.test(type);
}

export function takesActor(fn: ExportedFunction): boolean {
  return fn.params.some((param) => isActorType(param.type));
}

/**
 * Every entity id the **caller supplies**, by parameter or by object field.
 *
 * The actor's own ids are not among them. An actor carries `userId` and
 * `vendorIds`, but those say who is asking rather than what is being asked
 * about, and counting them would report every guarded function as taking an
 * id — which would make this list useless for deciding which functions the
 * matrix has to exercise.
 */
export function entityIds(fn: ExportedFunction): readonly string[] {
  return fn.params
    .filter((param) => !isActorType(param.type))
    .flatMap((param) => [
      ...(namesEntityId(param.name) ? [param.name] : []),
      ...param.fields.map((field) => `${param.name}.${field}`),
    ]);
}

let cached: readonly ExportedFunction[] | undefined;

export function exportedFunctions(): readonly ExportedFunction[] {
  if (cached) return cached;

  const configPath = `${packageRoot}/tsconfig.json`;
  // Wrapped rather than passed by reference: `ts.sys.readFile` is a method on
  // `ts.sys`, and handing it over detached is the shape that loses `this`.
  const config = ts.readConfigFile(configPath, (path) => ts.sys.readFile(path));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, packageRoot);
  const program = ts.createProgram([entry], { ...parsed.options, noEmit: true });
  const checker = program.getTypeChecker();

  const source = program.getSourceFile(entry);
  if (!source) throw new Error(`cannot read ${entry}`);
  const moduleSymbol = checker.getSymbolAtLocation(source);
  if (!moduleSymbol) throw new Error(`${entry} exports nothing`);

  const found: ExportedFunction[] = [];

  for (const exported of checker.getExportsOfModule(moduleSymbol)) {
    const symbol =
      exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
    const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];
    if (!declaration) continue;

    const signatures = checker.getTypeOfSymbolAtLocation(symbol, declaration).getCallSignatures();
    if (signatures.length === 0) continue;

    // An overloaded export is one name with one authority story, so the union
    // of its parameters is the honest reading: an id reachable through any
    // overload is an id the function accepts.
    const params = new Map<string, Param>();
    for (const signature of signatures) {
      for (const parameter of signature.getParameters()) {
        const parameterType = checker.getTypeOfSymbolAtLocation(parameter, declaration);
        params.set(parameter.getName(), {
          name: parameter.getName(),
          type: checker.typeToString(parameterType),
          fields: objectFields(checker, parameterType),
        });
      }
    }

    found.push({
      name: exported.getName(),
      file: relative(packageRoot, declaration.getSourceFile().fileName),
      params: [...params.values()],
    });
  }

  cached = found.sort((a, b) => a.name.localeCompare(b.name));
  return cached;
}

/**
 * Entity-id property names one level into a parameter's type.
 *
 * One level, not deep: an id in a bag the caller builds is still an id the
 * function accepts, but chasing the whole object graph would flag every
 * function that touches a row.
 */
const PRIMITIVE =
  ts.TypeFlags.StringLike |
  ts.TypeFlags.NumberLike |
  ts.TypeFlags.BooleanLike |
  ts.TypeFlags.BigIntLike |
  ts.TypeFlags.ESSymbolLike |
  ts.TypeFlags.Null |
  ts.TypeFlags.Undefined |
  ts.TypeFlags.Void |
  ts.TypeFlags.Never;

function objectFields(checker: ts.TypeChecker, type: ts.Type): readonly string[] {
  const parts = type.isUnion() ? type.types : [type];
  const names = new Set<string>();

  for (const part of parts) {
    // A string has properties too (`length`, `at`), so the primitives are
    // dropped before anything is read off them; only a bag the caller builds
    // can hold an id.
    if (part.flags & PRIMITIVE) continue;
    if (checker.getSignaturesOfType(part, ts.SignatureKind.Call).length > 0) continue;
    for (const property of checker.getPropertiesOfType(part)) {
      if (namesEntityId(property.getName())) names.add(property.getName());
    }
  }

  return [...names].sort();
}
