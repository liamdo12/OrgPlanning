import nodeLibrary from "@occasion/config/eslint/node-library";
import {
  noGlobalConfigAccess,
  restrictedImports,
  DB_FORBIDDEN_IMPORTS,
  SOURCE_GLOB,
} from "@occasion/config/eslint/base";

export default [
  ...nodeLibrary,
  {
    files: SOURCE_GLOB,
    rules: {
      // The connection string arrives as an argument, never from the environment.
      ...noGlobalConfigAccess.rules,
      ...restrictedImports(DB_FORBIDDEN_IMPORTS).rules,
    },
  },
];
