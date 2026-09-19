import { expect, test } from "@playwright/test";
import { signInAsAdmin } from "../fixtures/auth.js";
import { stripeConfigured } from "../fixtures/seed.js";
import { ANONYMOUS_STATE } from "../fixtures/state.js";
import { RUN_ID } from "../fixtures/run-id.js";

/**
 * A day's work on the admin surface, end to end.
 *
 * One test rather than ten, because it is a journey: the transfer at the end
 * exists because of the order confirmed near the beginning, and splitting it
 * into independent cases would mean either ten fixtures or ten tests that
 * quietly depend on each other's order. The steps are named, so a failure says
 * which part of the day broke.
 *
 * It reseeds first, which is what lets it run against the persistent demo
 * environment twice in a row: its second pass would otherwise find Kimchi Kart
 * already approved and fail on a button that is correctly no longer there.
 */

test.describe.configure({ mode: "serial" });

// Anonymous to start with, because signing in is the journey's first step and
// the whole point of a journey is that it begins where a person begins. The
// environment was reseeded by `auth.setup.ts`, which is what lets this run
// twice in a row against the same deployment.
test.use({ storageState: ANONYMOUS_STATE });

test("an administrator works through the platform", async ({ page }) => {
  test.slow();

  await test.step("signs in", async () => {
    await signInAsAdmin(page, "/admin/vendors");
    await expect(page.getByRole("heading", { name: "Vendors" })).toBeVisible();
  });

  await test.step("approves the application in the queue", async () => {
    const row = page.getByRole("listitem").filter({ hasText: "Kimchi Kart" });

    // The row's action, not its badge. Each button names the business it acts
    // on, so it is unambiguous, and it says what the row will let an
    // administrator do next — which is the thing that actually changed. The
    // badge reads "approved", and so does the toast that appears beside it.
    await expect(row.getByRole("button", { name: "Approve Kimchi Kart" })).toBeVisible();
    await row.getByRole("button", { name: "Approve Kimchi Kart" }).click();

    await expect(row.getByRole("button", { name: "Suspend Kimchi Kart" })).toBeVisible({
      timeout: 20_000,
    });
  });

  await test.step("approves the account waiting for it", async () => {
    await page.getByRole("link", { name: "Users" }).first().click();
    await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();

    // Same shape as the vendor list: every row action names the account, which
    // is what makes "Approve" unambiguous on a screen showing twelve of them.
    const pending = page.getByRole("listitem").filter({ hasText: "Dae Kim" }).first();
    await pending.getByRole("button", { name: "Approve Dae Kim" }).click();

    // An active account offers Suspend, and a pending one does not.
    await expect(pending.getByRole("button", { name: "Suspend Dae Kim" })).toBeVisible({
      timeout: 20_000,
    });
  });

  await test.step("resends verification to the one who never confirmed", async () => {
    const unverified = page.getByRole("listitem").filter({ hasText: "Jonah Tran" }).first();
    await expect(unverified.getByRole("button", { name: "Resend email Jonah Tran" })).toBeVisible();

    await unverified.getByRole("button", { name: "Resend email Jonah Tran" }).click();

    // The provider is a local stack here; what matters is that the action is
    // reported rather than failing silently.
    await expect(page.getByRole("status").or(page.getByRole("alert")).first()).toBeVisible({
      timeout: 20_000,
    });
  });

  await test.step("suspends and reinstates an account", async () => {
    const bea = page.getByRole("listitem").filter({ hasText: "Bea Varga" }).first();

    // Seeded suspended, so the round trip starts with the reinstatement.
    await expect(bea.getByRole("button", { name: "Reinstate Bea Varga" })).toBeVisible();
    await bea.getByRole("button", { name: "Reinstate Bea Varga" }).click();
    await expect(bea.getByRole("button", { name: "Suspend Bea Varga" })).toBeVisible({
      timeout: 20_000,
    });

    // Suspension asks why before it runs, and the reason is what the vendor is
    // eventually shown, so it is not optional.
    await bea.getByRole("button", { name: "Suspend Bea Varga" }).click();
    await page.getByLabel("Reason").fill(`Chargebacks ${RUN_ID}`);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /suspend/i })
      .click();
    await expect(bea.getByRole("button", { name: "Reinstate Bea Varga" })).toBeVisible({
      timeout: 20_000,
    });
  });

  await test.step("retries the balance on the order that is waiting", async () => {
    if (!stripeConfigured()) {
      // Not silently passed over: the annotation is in the report, and the step
      // below would otherwise assert only that the screen said *something* —
      // which it also says when the provider rejects the API key.
      test.info().annotations.push({
        type: "not exercised",
        description:
          "STRIPE_SECRET_KEY is the template placeholder, so the retry cannot reach the provider. Set a real sk_test_ key to exercise the decline path.",
      });
      return;
    }

    await page.getByRole("link", { name: "Orders" }).first().click();
    await expect(page.getByRole("heading", { name: "Orders and payments" })).toBeVisible();

    // Found through the screen's own filter rather than by reference. Which
    // order is waiting on a declined balance is a property of the seed, and a
    // hard-coded reference makes this step fail the day the seed changes for a
    // reason that has nothing to do with retrying a balance.
    //
    // The filter is a query parameter by design — that is what lets a record be
    // linked to — so it is set the way a link would, and the chip is then
    // asserted pressed to prove the screen reads the parameter this names.
    await page.goto("/admin/orders?state=action_required");
    await expect(page.getByRole("button", { name: "action req." })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    const waiting = page.getByRole("link", { name: /^TO-/ }).first();
    await expect(waiting).toBeVisible();
    await waiting.click();

    const retry = page.getByRole("button", { name: /^Retry balance on TO-/ });
    await expect(retry).toBeVisible();
    await retry.click();

    // The card declines again on a test provider, which is the point: the
    // administrator is told, and the customer is sent a fresh single-use link.
    await expect(page.getByRole("status").or(page.getByRole("alert")).first()).toBeVisible({
      timeout: 30_000,
    });
  });

  await test.step("marks a delivered order fulfilled", async () => {
    await page.goto("/admin/orders?state=confirmed");
    await expect(page.getByRole("button", { name: "confirmed", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    const confirmed = page.getByRole("link", { name: /^TO-/ }).first();
    await expect(confirmed).toBeVisible();
    const reference = ((await confirmed.textContent()) ?? "").trim();
    await confirmed.click();

    await page.getByRole("button", { name: `Mark fulfilled on ${reference}` }).click();

    // The action offered next is the proof the state moved: a fulfilled order
    // has nothing left to fulfil.
    await expect(page.getByRole("button", { name: `Mark fulfilled on ${reference}` })).toHaveCount(
      0,
      { timeout: 20_000 },
    );
  });

  await test.step("moves the demo clock to the cooling window and runs what is due", async () => {
    // Straight there rather than through the nav: the order record is still
    // open over it, and a drawer covering a link is correct behaviour rather
    // than something to click through.
    await page.goto("/admin/ops");
    await expect(page.getByRole("heading", { name: "Automations" })).toBeVisible();

    await page.getByRole("button", { name: "+48h" }).click();
    await expect(page.getByText("+48h").first()).toBeVisible({ timeout: 20_000 });

    await page.getByRole("button", { name: "Run due jobs" }).click();

    // The run's own record, which is the provenance an audit months later
    // depends on. "The vendor was paid on the 6th of March" and "somebody
    // demonstrated the March payout in September" are different facts, and the
    // history says which by carrying both times and marking the difference.
    const history = page.locator("section").filter({ hasText: "Recent runs" });
    await expect(history).toBeVisible();

    const byHand = history.getByText("by hand").first();
    await expect(byHand).toBeVisible({ timeout: 30_000 });
    await expect(history.getByText(/, as of /).first()).toBeVisible();
  });

  await test.step("finds the lifecycle's own messages in Recently sent", async () => {
    await page.goto("/admin/email");
    await expect(page.getByRole("heading", { name: "Email" })).toBeVisible();

    // The run above completed an order, and completing one sends its customer a
    // message. So the log is not empty by the time this looks — which is the
    // state that used to take the whole screen down, because a raw aggregate
    // handed the date formatter a string.
    const log = page.locator("section").filter({ hasText: "Recently sent" });
    await expect(log).toBeVisible();
    await expect(log.getByText("Nothing sent yet")).toHaveCount(0);
    await expect(log.getByText(/·/).first()).toBeVisible({ timeout: 20_000 });
  });

  await test.step("puts the clock back", async () => {
    // Left behind, the override is a demo environment that silently believes it
    // is two days from now for the next person who opens it.
    await page.goto("/admin/ops");
    const clear = page.getByRole("button", { name: /^now$/i }).first();
    if (await clear.isVisible()) await clear.click();
  });
});
