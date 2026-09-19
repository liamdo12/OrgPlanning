import { randomBytes } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";

/**
 * The end-to-end suite.
 *
 * It runs against a **running app and a real database** rather than a mock: the
 * claims worth making here — that an approval reaches the list, that a clock
 * jump charges a card, that the whole journey can be done from the keyboard —
 * are claims about the stack assembled, and every one of them has a component
 * test that already passes.
 *
 * `fullyParallel` is off and there is one worker. The journey moves seeded rows
 * through their lifecycle, and two workers doing that at once would be two
 * administrators fighting over the same six vendors. The suite's value is in
 * being repeatable, not in being quick.
 */

const appUrl = process.env["APP_URL"] ?? "http://localhost:3000";

/**
 * One password for the whole run, minted here.
 *
 * This file is read once in the main process and every worker inherits its
 * environment, which is the only place the value can be agreed on: generated
 * inside the fixture instead, the setup worker and the test workers each made
 * their own and the tests failed with "that email and password do not match".
 *
 * Never defaulted to a constant, and never committed. It is set on throwaway
 * demo accounts on a stack the suite has just reseeded.
 */
process.env["E2E_PASSWORD"] ??= `e2e-${randomBytes(12).toString("base64url")}`;

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env["CI"]),
  // One retry in CI only. Locally a flake should be seen, not smoothed over.
  retries: process.env["CI"] ? 1 : 0,
  reporter: process.env["CI"] ? [["github"], ["html", { open: "never" }]] : [["list"]],
  timeout: 90_000,
  expect: { timeout: 15_000 },

  use: {
    baseURL: appUrl,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    // The journey moves money and runs jobs; a stray click on a disabled
    // control should fail rather than wait for a timeout.
    actionTimeout: 15_000,
  },

  projects: [
    {
      // Reseeds and signs each identity in once, so the rest of the suite does
      // not spend the platform's login allowance on setup.
      name: "setup",
      testMatch: /auth\.setup\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      // The width the prototype's admin screens are drawn at.
      name: "desktop",
      dependencies: ["setup"],
      testIgnore: /auth\.setup\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "mobile",
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], viewport: { width: 375, height: 812 } },
      // The full journey is a desktop operator task. At a phone width the suite
      // asserts that the screens are usable and accessible, not that every
      // dialog can be driven.
      testMatch: /admin-a11y\.spec\.ts/,
    },
  ],

  // Started here unless `E2E_NO_SERVER` says one is already running, which is
  // the case when `APP_URL` points at a deployment. Spread rather than set to
  // `undefined`, because the config's own types do not accept an absent server
  // written that way.
  ...(process.env["E2E_NO_SERVER"]
    ? {}
    : {
        webServer: {
          // A dev server locally, and the standalone build in CI — which is the
          // artefact that gets deployed, and the one whose boot-time
          // environment validation actually runs.
          command: process.env["E2E_WEB_COMMAND"] ?? "pnpm --filter @occasion/web dev",
          url: appUrl,
          reuseExistingServer: !process.env["CI"],
          timeout: 180_000,
          cwd: "../..",
        },
      }),
});
