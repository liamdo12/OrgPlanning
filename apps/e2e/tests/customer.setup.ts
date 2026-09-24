import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { test as setup } from "@playwright/test";
import { signInAsCustomer, signInAsNewCustomer } from "../fixtures/auth.js";
import { provisionNewCustomer, resetEnvironment } from "../fixtures/seed.js";
import { CUSTOMER_STATE, NEW_CUSTOMER_STATE } from "../fixtures/state.js";

/**
 * The two customer sessions, minted after the admin projects have run.
 *
 * The MFA spec signs the seeded customer in, enrols an authenticator and turns
 * it off again — and says in its own comments that doing so invalidates the
 * stored session. Until now the only consumer of that session was the
 * authorization spec, which asserts that an ordinary account is **refused** the
 * admin screens: a dead session is refused too, so the breakage was invisible.
 *
 * The customer specs are the first that need the session to actually work, so
 * they get their own door. Both sign in the way a person does, for the same
 * reason the first setup does — the sign-in path is where the provider subject
 * is bound to the row and where the second-factor check happens.
 *
 * The second account is built here rather than in the first setup because it
 * adds a row to `users`, and here is after every admin assertion about who is
 * on the platform has already been made.
 *
 * **It reseeds first, for the same reason the admin half gets a reseed.** The
 * admin journey moves seeded rows through their lifecycle — a booking it marks
 * delivered is a booking the customer can no longer call off — and it leaves a
 * clock override behind, which is a shifted "now" on every screen that reads
 * one. Inheriting all of that would make the customer journeys pass or fail on
 * what the admin specs happened to do, which is not a claim about the customer
 * surface. Nothing runs after this that asserts anything the reseed undoes.
 */

setup("sign the customer in again, after anything that signed them out", async ({ page }) => {
  setup.slow();
  mkdirSync(dirname(CUSTOMER_STATE), { recursive: true });

  await resetEnvironment();

  await page.context().clearCookies();
  await signInAsCustomer(page, "/");
  await page.context().storageState({ path: CUSTOMER_STATE });
});

setup("sign in the customer who has planned nothing", async ({ page }) => {
  mkdirSync(dirname(NEW_CUSTOMER_STATE), { recursive: true });

  await provisionNewCustomer();

  await page.context().clearCookies();
  await signInAsNewCustomer(page, "/");
  await page.context().storageState({ path: NEW_CUSTOMER_STATE });
});
