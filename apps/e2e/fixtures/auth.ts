import { expect, type Page } from "@playwright/test";
import { ADMIN_EMAIL, CUSTOMER_EMAIL, NEW_CUSTOMER_EMAIL, SIGN_IN_PASSWORD } from "./seed.js";

/**
 * Signing in the way a person does.
 *
 * Deliberately through the form rather than by writing a session cookie. The
 * sign-in path is where `getActor` binds the provider subject to the row, where
 * the second-factor check happens and where the redirect back to the requested
 * page is decided — a fixture that skipped it would test every admin screen
 * without ever testing the door.
 */
async function signIn(page: Page, email: string, next: string): Promise<void> {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await submitSignIn(page, email);
}

/**
 * The same form, on the login screen the app has already sent us to.
 *
 * Its own export for the journey that arrives here by being refused something:
 * that journey's whole point is the address it was asking for travelling with
 * the redirect, so it must not navigate to a login screen of its own making.
 */
export async function submitSignIn(page: Page, email: string): Promise<void> {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(SIGN_IN_PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();

  // Off the login screen, and no error where the form puts one. Waiting on the
  // URL alone would pass for a redirect that bounced straight back.
  //
  // Scoped to the form rather than to `role=alert`: Next's development overlay
  // mounts an alert of its own on every page, so the unscoped version fails
  // against a dev server and passes against a build — the worst way round.
  try {
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });
  } catch (error) {
    // The form says why, and a bare navigation timeout hides it. "Too many
    // attempts" and "that email and password do not match" send whoever is
    // reading the failure to two completely different places.
    const said = await page
      .locator("form p[role='alert']")
      .first()
      .textContent()
      .catch(() => null);
    throw said ? new Error(`Sign-in as ${email} was refused: ${said.trim()}`) : error;
  }

  await expect(page.locator("form p[role='alert']")).toHaveCount(0);
}

export async function signInAsAdmin(page: Page, next = "/admin/vendors"): Promise<void> {
  await signIn(page, ADMIN_EMAIL, next);
  // The admin shell, specifically: the login screen has a nav of its own, so
  // "a navigation is visible" is true before signing in too.
  await expect(page.getByRole("link", { name: "Vendors" }).first()).toBeVisible();
}

/** Signed in, in good standing, and holding no admin role. */
export async function signInAsCustomer(page: Page, next = "/"): Promise<void> {
  await signIn(page, CUSTOMER_EMAIL, next);
}

/** The same door, for the account the suite provisions with nothing in it. */
export async function signInAsNewCustomer(page: Page, next = "/"): Promise<void> {
  await signIn(page, NEW_CUSTOMER_EMAIL, next);
}
