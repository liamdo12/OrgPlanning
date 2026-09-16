import globals from "globals";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import { base } from "./base.mjs";

/**
 * Config for apps/web. This is the only package allowed to read `process.env`,
 * and even here it is confined to the validated env module (enforced below).
 */
export default [
  ...base,
  {
    files: ["**/*.{ts,tsx}"],
    plugins: { react, "react-hooks": reactHooks },
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: { react: { version: "detect" } },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...react.configs.flat["jsx-runtime"].rules,
      ...reactHooks.configs.recommended.rules,
      "react/prop-types": "off",
      "no-process-env": "error",
    },
  },
  {
    // The sanctioned readers of raw environment variables. `env.ts` is the
    // only validator; `proxy.ts` runs in the middleware runtime, which carries
    // a truncated environment that the full schema would reject, and the rest
    // are build-time config.
    files: ["src/lib/env.ts", "proxy.ts", "*.config.{ts,mjs,js}", "instrumentation.ts"],
    rules: { "no-process-env": "off" },
  },
];
