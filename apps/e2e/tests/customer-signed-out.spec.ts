import { expect, test } from "@playwright/test";
import { ANONYMOUS_STATE } from "../fixtures/state.js";

/**
 * What a stranger can see, and what they are asked to sign in for.
 *
 * The catalogue is public on purpose — somebody has to be able to look before
 * they have an account — and the planner is not. The line between the two is
 * the claim this file exists to hold.
 *
 * Note for whoever writes the rest: a customer route that refuses answers
 * **200** with the not-found body, which is accepted. Do not assert a 404
 * status here; assert what the screen says.
 */

test.use({ storageState: ANONYMOUS_STATE });

test("shows the catalogue to somebody with no account", async ({ page }) => {
  await page.goto("/services");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  const listing = page.locator("article a[href^='/services/']").first();
  await expect(listing).toBeVisible();
  await listing.click();

  await page.waitForURL(/\/services\/[^/]+$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("asks a stranger to sign in before the planner, and comes back", async ({ page }) => {
  await page.goto("/events");

  await page.waitForURL(/\/login/);
  // The address being asked for travels with the redirect, so signing in lands
  // on the screen that was wanted rather than on a home page.
  expect(new URL(page.url()).searchParams.get("next")).toBe("/events");
});

test("offers to save a listing, and sends the shortlist through the door", async ({ page }) => {
  test.fixme(
    true,
    "Signing in from the heart and returning to the listing with it filled in needs the journey the signed-in specs cover; wire it here once the checkout half exists.",
  );

  await page.goto("/services");
});
