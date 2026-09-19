import { expect, test, type Page } from "@playwright/test";
import { ADMIN_STATE } from "../fixtures/state.js";
import { runScoped } from "../fixtures/run-id.js";

/**
 * The four capabilities the prototype never drew, driven the way an operator
 * drives them.
 *
 * The domain suites already assert that closing a case frees the booking it
 * froze and that removing a review reaches the row. What none of them runs is
 * Next.js: the server action, the revalidation, the drawer that re-reads, and
 * the button that is or is not drawn afterwards. That is what this walks.
 *
 * Self-resetting, like the journey beside it: the setup project reseeds the
 * demo rows before the suite starts, and anything this file creates is named
 * with the run id so a second pass does not collide with the first.
 */

test.use({ storageState: ADMIN_STATE });

/** Opens a screen and waits for its heading, which is the page being ready. */
async function open(page: Page, path: string, heading: string) {
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
}

test.describe.configure({ mode: "serial" });

test("a complaint is recorded, investigated and closed", async ({ page }) => {
  await open(page, "/admin/disputes", "Disputes");

  const reason = runScoped("Late delivery");

  await page.getByRole("button", { name: "Record a complaint" }).click();
  await page.getByRole("textbox", { name: "Booking reference" }).fill("TO-4192");
  await page.getByRole("textbox", { name: "What the complaint is" }).fill(reason);
  await page
    .getByRole("textbox", { name: "What was said" })
    .fill("Customer called; the flowers were two hours late.");
  await page.getByRole("button", { name: "Open the case" }).click();

  // The row arrives in the queue, which is the revalidation having happened.
  const row = page.getByRole("link", { name: `Open ${reason}` });
  await expect(row).toBeVisible();

  await row.click();
  const drawer = page.getByRole("dialog", { name: reason });
  await expect(drawer).toBeVisible();

  await drawer.getByRole("button", { name: "Assign to me" }).click();
  await expect(drawer.getByText("With Occasion Admin")).toBeVisible();

  await drawer.getByRole("button", { name: "Start investigating" }).click();
  await expect(drawer.getByText("Investigating")).toBeVisible();

  await drawer
    .getByRole("textbox", { name: "Internal note" })
    .fill("Vendor confirms the window was restated.");
  await drawer.getByRole("button", { name: "Add note" }).click();
  await expect(drawer.getByText("Vendor confirms the window was restated.")).toBeVisible();

  await drawer
    .getByRole("textbox", { name: "How it was resolved" })
    .fill("Vendor warned; the booking stands.");
  await drawer.getByRole("button", { name: "Close the case" }).click();

  // Closed: the forms are gone and the outcome is what is left.
  await expect(drawer.getByRole("button", { name: "Close the case" })).toHaveCount(0);
  await expect(drawer.getByText("Vendor warned; the booking stands.")).toBeVisible();
});

test("a reported profile line is taken down", async ({ page }) => {
  await open(page, "/admin/moderation", "Moderation");

  const card = page.locator("article").filter({ hasText: "Misleading claim" });
  await expect(card).toBeVisible();

  // Two decisions, not three: a one-line profile has nowhere to be hidden to.
  await expect(card.getByRole("button", { name: "Hide" })).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Keep" })).toBeVisible();

  await card.getByRole("textbox", { name: "Why" }).fill("Could not be substantiated.");
  await card.getByRole("button", { name: "Remove" }).click();

  await expect(page.getByText("Removed.", { exact: false })).toBeVisible();

  // It leaves the waiting queue, which is the decision having been recorded
  // rather than merely applied to the content.
  await open(page, "/admin/moderation", "Moderation");
  await expect(page.locator("article").filter({ hasText: "Misleading claim" })).toHaveCount(0);
});

test("a category is added, moved and deleted", async ({ page }) => {
  await open(page, "/admin/categories", "Categories");

  const name = runScoped("Lighting");

  await page.getByRole("button", { name: "Add a category" }).click();
  await page.getByRole("textbox", { name: "Name", exact: true }).fill(name);
  await page.getByRole("button", { name: "Add", exact: true }).click();

  const row = page.getByRole("listitem").filter({ hasText: name });
  await expect(row).toBeVisible();

  // It lands at the end, so the only move available is up.
  await row.getByRole("button", { name: "Move up" }).click();
  await expect(page.getByText("Moved.")).toBeVisible();

  // Nothing is filed under it, so this one may be deleted outright — which the
  // seeded six may not.
  const seeded = page.getByRole("listitem").filter({ hasText: "Flowers" });
  await expect(seeded.getByRole("button", { name: "Delete Flowers" })).toHaveCount(0);

  await page
    .getByRole("listitem")
    .filter({ hasText: name })
    .getByRole("button", { name: `Delete ${name}` })
    .click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();

  await expect(page.getByRole("listitem").filter({ hasText: name })).toHaveCount(0);
});

test("a deactivated category keeps its listings", async ({ page }) => {
  await open(page, "/admin/categories", "Categories");

  const row = page.getByRole("listitem").filter({ hasText: "Cakes" });
  await row.getByRole("button", { name: "Deactivate Cakes" }).click();

  await expect(page.getByText("Deactivated.", { exact: false })).toBeVisible();
  await expect(row.getByText("Not offered")).toBeVisible();
  // The listings are still filed under it: that is the whole point of
  // deactivating rather than deleting.
  await expect(row.getByText("2 services")).toBeVisible();

  await row.getByRole("button", { name: "Offer Cakes" }).click();
  await expect(page.getByText("Offered again.", { exact: false })).toBeVisible();
});

test("the analytics screen answers the operator's questions", async ({ page }) => {
  await open(page, "/admin/analytics", "Analytics");

  // Streamed behind a boundary, so the figures arrive after the heading.
  await expect(page.getByText("Gross bookings")).toBeVisible();
  await expect(page.getByText("Commission earned")).toBeVisible();
  await expect(page.getByText("Vendors, now")).toBeVisible();

  // The period is in the URL, so a view somebody is looking at has a link.
  await page.getByRole("button", { name: "All time" }).click();
  await expect(page).toHaveURL(/period=all/);
  await expect(page.getByText("all time")).toBeVisible();
});

test("a rate an administrator sets is the rate that is in force", async ({ page }) => {
  await open(page, "/admin/settings", "Settings");

  const commission = page.locator("section").filter({ hasText: "Charged on the pre-tax subtotal" });
  await expect(commission.getByText("10%")).toBeVisible();

  await commission.getByRole("spinbutton", { name: "Basis points (100 = 1%)" }).fill("1250");
  await commission.getByRole("button", { name: "Save" }).click();

  await expect(page.getByText("Saved.", { exact: false })).toBeVisible();
  await expect(commission.getByText("12.5%")).toBeVisible();

  // The three that are decided elsewhere say so instead of offering a field.
  const currency = page.locator("section").filter({ hasText: "The only currency" });
  await expect(currency.getByText("Set elsewhere")).toBeVisible();
  await expect(currency.getByRole("button", { name: "Save" })).toHaveCount(0);

  await commission.getByRole("spinbutton", { name: "Basis points (100 = 1%)" }).fill("1000");
  await commission.getByRole("button", { name: "Save" }).click();
  await expect(commission.getByText("10%")).toBeVisible();
});
