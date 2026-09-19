import { expect, test } from "@playwright/test";
import { CUSTOMER_EMAIL, SIGN_IN_PASSWORD, clearSecondFactors } from "../fixtures/seed.js";
import { ANONYMOUS_STATE } from "../fixtures/state.js";
import { msLeftInStep, totp } from "../fixtures/totp.js";

/**
 * The second factor, enrolled and then answered.
 *
 * Nothing on this platform requires a second factor. What it does require is
 * that once somebody has one, **every** session clears it — and that
 * requirement lives on our own row rather than on the provider's session
 * object, because the session arrives in a cookie the browser controls. A
 * stolen password plus an edited cookie must not be enough.
 *
 * That property cannot be checked without going all the way round: enrol, sign
 * out, sign in again, and be stopped. Which is what this does, against a real
 * authenticator's arithmetic.
 *
 * It uses the customer account rather than the administrator's, so a failure
 * halfway cannot leave the account the rest of the suite signs in as holding a
 * factor nothing knows the secret for. The reseed clears any factor left behind
 * regardless.
 */

test.use({ storageState: ANONYMOUS_STATE });

/**
 * Whatever happened, this account leaves with no authenticator.
 *
 * The last step turns it off, and a failure before that step would skip it —
 * and a retry re-runs this test, not the setup project, so it would land on a
 * challenge for a secret that only the failed run ever held. The factor also
 * invalidates the stored customer session the authorization spec uses, so
 * leaving one behind breaks a spec that has nothing to do with this one.
 */
test.afterEach(async () => {
  await clearSecondFactors(CUSTOMER_EMAIL);
});

/**
 * A code that is neither about to expire nor already spent.
 *
 * Two different waits, both of which a person makes without thinking about it.
 * A code entered in the last moment of its window is checked in the next one
 * and refused; and a code already used once is refused for the rest of its
 * window, because the provider will not accept a replay. An authenticator app
 * shows the same six digits for thirty seconds, so "use the next one" is the
 * ordinary answer to both.
 */
async function freshCode(secret: string, spent?: string): Promise<string> {
  if (msLeftInStep() < 3_000) {
    await new Promise((resolve) => setTimeout(resolve, msLeftInStep() + 500));
  }

  let code = totp(secret);
  if (spent && code === spent) {
    await new Promise((resolve) => setTimeout(resolve, msLeftInStep() + 500));
    code = totp(secret);
  }

  return code;
}

test("an account with a second factor is asked for it every time", async ({ page }) => {
  test.slow();

  async function signIn(next: string): Promise<void> {
    await page.goto(`/login?next=${encodeURIComponent(next)}`);
    await page.getByLabel("Email").fill(CUSTOMER_EMAIL);
    await page.getByLabel("Password").fill(SIGN_IN_PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();

    // Off the login screen before anything is asserted, so a refusal surfaces
    // here rather than as a missing heading three lines later.
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });
  }

  let secret = "";
  let spent = "";

  await test.step("enrols an authenticator", async () => {
    await signIn("/mfa");
    await page.goto("/mfa");

    await expect(page.getByRole("heading", { name: "Two-step verification" })).toBeVisible();

    await page.getByRole("button", { name: "Set up two-step verification" }).click();

    // The provider hands out the secret once. The page shows it as text beside
    // the QR code, for somebody who cannot scan — which is also the only way a
    // test can hold it.
    const shown = page.locator("code").first();
    await expect(shown).toBeVisible();
    secret = ((await shown.textContent()) ?? "").trim();
    expect(secret.length).toBeGreaterThan(15);

    spent = await freshCode(secret);
    await page.getByLabel("Six-digit code").fill(spent);
    await page.getByRole("button", { name: "Turn on two-step verification" }).click();

    await expect(page.getByText("Two-step verification is on.")).toBeVisible({ timeout: 20_000 });
  });

  await test.step("stops the next sign-in until the code is given", async () => {
    await page.context().clearCookies();
    await signIn("/mfa");

    // The challenge is where the action itself sends them, so this is the one
    // navigation the spec does not make for itself.
    await expect(page.getByRole("heading", { name: "Enter your code" })).toBeVisible({
      timeout: 30_000,
    });

    // The whole point: the password was right and it was not enough.
    await expect(page.getByRole("heading", { name: "Two-step verification" })).toHaveCount(0);
  });

  await test.step("refuses a wrong code", async () => {
    await page.getByLabel("Six-digit code").fill("000000");
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(page.getByRole("heading", { name: "Enter your code" })).toBeVisible();
    await expect(page.getByText(/not accepted/i)).toBeVisible();
  });

  await test.step("lets the right code through", async () => {
    await page.getByLabel("Six-digit code").fill(await freshCode(secret, spent));
    await page.getByRole("button", { name: "Continue" }).click();

    await page.waitForURL((url) => !url.pathname.startsWith("/mfa/challenge"), {
      timeout: 30_000,
    });
    await expect(page.getByRole("heading", { name: "Two-step verification" })).toBeVisible();
  });

  await test.step("turns it off again", async () => {
    // Left on, the account is one nothing in the suite can sign in as again —
    // the secret only ever existed in this test's memory.
    await page.getByRole("button", { name: "Turn off two-step verification" }).click();
    await expect(page.getByText("Two-step verification is off.")).toBeVisible({ timeout: 20_000 });
  });
});
