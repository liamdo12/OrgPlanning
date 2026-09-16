import globals from "globals";
import { base } from "./base.mjs";

/** Config for a server-side package (packages/core, packages/db). */
export default [
  ...base,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
  },
];
