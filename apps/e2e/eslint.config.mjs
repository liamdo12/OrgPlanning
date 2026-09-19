import nodeLibrary from "@occasion/config/eslint/node-library";

export default [
  ...nodeLibrary,
  {
    ignores: ["playwright-report/**", "test-results/**"],
  },
  {
    // The suite is the one place that reads the environment on purpose: it is
    // told where the app is, which database to reseed, and which key may mint
    // a password. Everything it drives gets its configuration the proper way.
    files: ["**/*.ts"],
    rules: { "no-process-env": "off" },
  },
];
