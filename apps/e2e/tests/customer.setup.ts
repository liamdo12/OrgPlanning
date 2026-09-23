import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { test as setup } from "@playwright/test";
import { signInAsCustomer } from "../fixtures/auth.js";
import { CUSTOMER_STATE } from "../fixtures/state.js";

/**
 * A fresh customer session, minted after the admin projects have run.
 *
 * The MFA spec signs this same account in, enrols an authenticator and turns it
 * off again — and says in its own comments that doing so invalidates the stored
 * customer session. Until now the only consumer of that session was the
 * authorization spec, which asserts that an ordinary account is **refused** the
 * admin screens: a dead session is refused too, so the breakage was invisible.
 *
 * The customer specs are the first that need the session to actually work, so
 * they get their own door. It signs in the way a person does, for the same
 * reason the first setup does — the sign-in path is where the provider subject
 * is bound to the row and where the second-factor check happens.
 */

setup("sign the customer in again, after anything that signed them out", async ({ page }) => {
  mkdirSync(dirname(CUSTOMER_STATE), { recursive: true });

  await page.context().clearCookies();
  await signInAsCustomer(page, "/");
  await page.context().storageState({ path: CUSTOMER_STATE });
});
