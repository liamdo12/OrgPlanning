import reactLibrary from "@occasion/config/eslint/react-library";
import { restrictedImports, UI_FORBIDDEN_IMPORTS, SOURCE_GLOB } from "@occasion/config/eslint/base";

export default [
  ...reactLibrary,
  // Presentation only: no domain, no database, no app imports.
  { files: SOURCE_GLOB, rules: restrictedImports(UI_FORBIDDEN_IMPORTS).rules },
];
