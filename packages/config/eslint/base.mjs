import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import globals from "globals";

/**
 * Shared flat config for every package in the monorepo.
 *
 * `projectService` turns on type-aware linting without naming tsconfig paths
 * per package — each package's own tsconfig.json is discovered from the file.
 */
export const base = tseslint.config(
  {
    ignores: ["**/dist/**", "**/.next/**", "**/.turbo/**", "**/coverage/**", "**/node_modules/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: process.cwd(),
      },
      globals: { ...globals.es2023 },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
  {
    files: ["**/*.config.{js,mjs,ts}", "**/*.mjs"],
    ...tseslint.configs.disableTypeChecked,
  },
  prettier,
);

/**
 * File globs the domain boundaries apply to.
 *
 * Deliberately wider than `.ts`: a rule that stops applying the moment someone
 * writes JSX is not a boundary. An email template written as `.tsx` is exactly
 * the file that would otherwise import React and read the environment freely.
 */
export const SOURCE_GLOB = ["src/**/*.{ts,tsx,mts,cts,js,mjs,cjs}"];

/**
 * `packages/core` and `packages/db` are framework-free and config-free. They
 * receive everything through `CoreContext`, so reading global process state is
 * an error, not a style preference. `apps/web` is the only place allowed to
 * touch `process.env`, via its validated `env` module.
 */
export const noGlobalConfigAccess = {
  rules: {
    "no-process-env": "error",
    "no-restricted-globals": [
      "error",
      {
        name: "process",
        message:
          "packages/core and packages/db must not read global state. Inject it through CoreContext (see packages/core/src/context.ts).",
      },
    ],
    "no-restricted-properties": [
      "error",
      {
        object: "process",
        property: "env",
        message: "Inject config through CoreContext instead of reading process.env.",
      },
    ],
  },
};

/**
 * Import boundaries: core may not reach for the framework or the app; ui may
 * not reach for the domain.
 */
export function restrictedImports(patterns) {
  return {
    rules: {
      "no-restricted-imports": ["error", { patterns }],
    },
  };
}

/**
 * Importing the process module sidesteps every `process.env` rule above: the
 * import binding shadows the global, so `no-restricted-globals` never fires and
 * `no-process-env` sees a plain identifier. Editors auto-import it, so this is
 * the accidental path, not an adversarial one.
 */
const PROCESS_MODULE = {
  group: ["process", "node:process"],
  message: "Inject config through CoreContext instead of importing the process module.",
};

export const CORE_FORBIDDEN_IMPORTS = [
  {
    group: ["next", "next/*", "react", "react-dom", "server-only"],
    message:
      "The domain layer stays framework-free so it can be lifted out of Next unchanged. Keep Next and React in apps/web.",
  },
  {
    group: ["@occasion/ui", "@occasion/ui/*"],
    message: "packages/core must not depend on the design system.",
  },
  {
    group: ["../../apps/*", "apps/*"],
    message: "packages/core must not import from apps/.",
  },
  PROCESS_MODULE,
];

export const DB_FORBIDDEN_IMPORTS = [
  {
    group: ["next", "next/*", "react", "react-dom", "server-only"],
    message: "packages/db is framework-free. Keep Next and React in apps/web.",
  },
  {
    group: ["@occasion/core", "@occasion/core/*", "@occasion/ui", "@occasion/ui/*"],
    message: "packages/db sits below the domain; it must not depend on it.",
  },
  {
    group: ["../../apps/*", "apps/*"],
    message: "packages/db must not import from apps/.",
  },
  PROCESS_MODULE,
];

export const UI_FORBIDDEN_IMPORTS = [
  {
    group: ["@occasion/core", "@occasion/core/*", "@occasion/db", "@occasion/db/*"],
    message: "packages/ui is presentation only. Pass domain data in as props.",
  },
  {
    group: ["../../apps/*", "apps/*"],
    message: "packages/ui must not import from apps/.",
  },
];

export default base;
