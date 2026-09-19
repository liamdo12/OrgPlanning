import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { test as setup } from "@playwright/test";
import { resetEnvironment } from "../fixtures/seed.js";
import { signInAsAdmin, signInAsCustomer } from "../fixtures/auth.js";
import { ADMIN_STATE, CUSTOMER_STATE } from "../fixtures/state.js";

/**
 * One reseed and one sign-in per identity, before anything else runs.
 *
 * A dependency of both viewport projects, so a filtered run of a single spec
 * still gets a reseeded environment and a session — which is what keeps the
 * suite runnable one file at a time while it is being written.
 */

setup("reseed the environment and sign each identity in once", async ({ page }) => {
  setup.slow();

  await resetEnvironment();

  mkdirSync(dirname(ADMIN_STATE), { recursive: true });

  await signInAsAdmin(page, "/admin/vendors");
  await page.context().storageState({ path: ADMIN_STATE });

  await page.context().clearCookies();
  await signInAsCustomer(page, "/");
  await page.context().storageState({ path: CUSTOMER_STATE });
});
