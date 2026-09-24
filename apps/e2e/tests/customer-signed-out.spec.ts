import { expect, test } from "@playwright/test";
import { submitSignIn } from "../fixtures/auth.js";
import { CUSTOMER_EMAIL } from "../fixtures/seed.js";
import { ANONYMOUS_STATE } from "../fixtures/state.js";

/**
 * What a stranger can see, and what they are asked to sign in for.
 *
 * The catalogue is public on purpose — somebody has to be able to look before
 * they have an account — and the planner is not. The line between the two is
 * the claim this file exists to hold.
 *
 * Note for whoever adds to it: a customer route that refuses answers **200**
 * with the not-found body, which is accepted. Do not assert a 404 status here;
 * assert what the screen says.
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
  await page.goto("/services");
  const card = page.locator("article a[href^='/services/']").first();
  await expect(card, "the results page showed no listing").toBeVisible();

  const path = (await card.getAttribute("href")) ?? "";
  await card.click();
  await page.waitForURL(/\/services\/[^/]+$/);
  const title = ((await page.getByRole("heading", { level: 1 }).textContent()) ?? "").trim();

  // For somebody with no account the heart is a link rather than a toggle:
  // there is no saved state to report, and `aria-pressed` on something that
  // navigates would be a lie about what pressing it does.
  const offer = page.getByRole("link", { name: `Sign in to save ${title}` });
  await expect(offer).toBeVisible();
  await offer.click();

  await page.waitForURL(/\/login/);
  expect(new URL(page.url()).searchParams.get("next")).toBe(path);

  await submitSignIn(page, CUSTOMER_EMAIL);
  await page.waitForURL(`**${path}`);

  // Back where they were, and the control is now the one that saves.
  const saved = page.getByRole("button", { name: `Saved — ${title}` });
  if ((await saved.count()) === 0) {
    await page.getByRole("button", { name: `Save ${title}` }).click();
  }
  await expect(saved).toBeVisible();
  await expect(saved).toHaveAttribute("aria-pressed", "true");

  await page.goto("/saved");
  await expect(page.getByRole("link", { name: title })).toBeVisible();
});
