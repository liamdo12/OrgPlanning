import nodeLibrary from "@occasion/config/eslint/node-library";
import {
  noGlobalConfigAccess,
  restrictedImports,
  CORE_FORBIDDEN_IMPORTS,
  SOURCE_GLOB,
} from "@occasion/config/eslint/base";

export default [
  ...nodeLibrary,
  {
    // Fixtures are written and removed by boundaries.test.ts. They contain
    // deliberate violations, so linting them here would fail the repo; the test
    // lints them explicitly with `ignore: false`.
    ignores: ["src/boundary-fixture-*/**"],
  },
  {
    // Wider than `.ts` on purpose: a rule that stops applying the moment
    // someone writes JSX is not a boundary.
    //
    // `.ts` and `.mjs` are checked by the rules below. `.tsx` and `.js` are not
    // in this package's tsconfig, so they fail linting with a project-service
    // parse error instead — which is the intended outcome. The domain layer is
    // TypeScript without JSX; a `.tsx` here would mean React in the domain,
    // which the import rules forbid anyway. If you landed here from that error,
    // the file belongs in apps/web or packages/ui.
    files: SOURCE_GLOB,
    rules: {
      // Everything the domain needs arrives through CoreContext.
      ...noGlobalConfigAccess.rules,
      // The domain stays liftable: no framework, no design system, no app.
      ...restrictedImports(CORE_FORBIDDEN_IMPORTS).rules,
    },
  },
];
