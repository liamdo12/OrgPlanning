import { expect, test, type Page } from "@playwright/test";
import {
  customerSession,
  ensurePlannedLine,
  makeEventActive,
  openCancellableBooking,
  openSeededEvent,
} from "../fixtures/customer.js";
import { stripeConfigured } from "../fixtures/seed.js";

/**
 * Taking something back.
 *
 * Two different acts, and the customer sees both: emptying a slot they had only
 * chosen, and cancelling a booking they had paid a deposit on. The first is
 * entirely this repository's and runs here in full.
 *
 * The second is one journey rather than two tests, because its halves are not
 * independent: a booking can only be cancelled once, so a second test starting
 * from "find the booking that can still be called off" would find nothing the
 * moment the first one succeeded.
 *
 * **The refund is not taken here** while `STRIPE_SECRET_KEY` is the template's
 * placeholder. The seeded deposit carries a fabricated payment intent, so the
 * provider would reject the refund even with a real key — which means the
 * cancelling half needs a booking this suite paid for itself, and that needs
 * the money path the browse journey also stops at. Everything before the
 * confirmation runs: the window, the offer, the dialog and what it promises.
 */

const EVENT = "Sarah's 30th";

test.use(customerSession);

test("empties a slot the customer had only chosen", async ({ page }) => {
  await makeEventActive(page, EVENT);
  // Its own subject, put back: at the second width the first pass has already
  // emptied the slot the seed left in the plan.
  await ensurePlannedLine(page);
  await openSeededEvent(page);

  const remove = page.getByRole("button", { name: "Remove" });
  const before = await remove.count();
  expect(before, "the planner had no slot in plan to empty").toBeGreaterThan(0);

  await remove.first().click();

  // One fewer slot in plan, and the category it belonged to is still on the
  // planner — emptying a slot must not take the category off the list.
  await expect(remove).toHaveCount(before - 1);
  await expect(page.getByText("Nothing added yet").first()).toBeVisible();
});

test("cancels a booking inside its free window, and gives the date back", async ({ page }) => {
  const booking = await openCancellableBooking(page);

  await test.step("the window is open, and the screen says until when", async () => {
    await expect(page.getByText(/^Free until /)).toBeVisible();
  });

  // The listing is read against the active event's date, so the event this
  // booking belongs to is the one being planned while the date is checked.
  await makeEventActive(page, EVENT);
  const listing = await openListingForVendor(page, booking.vendorName);

  await test.step("the date reads as taken while the booking stands", async () => {
    await expect(page.getByText(/Already booked on /)).toBeVisible();
  });

  await page.goto(`/orders/${booking.orderId}`);
  await page.getByRole("button", { name: "Cancel this booking" }).click();

  const dialog = page.getByRole("dialog");
  await test.step("the dialog says what goes back, and to where", async () => {
    await expect(dialog).toContainText(booking.vendorName);
    await expect(dialog).toContainText(/goes back to the card it was taken from/);
  });

  if (!stripeConfigured()) {
    // Not silently passed over: the annotation is in the run's report. Pressing
    // the button here would call the provider with the seed's fabricated
    // payment intent, and the refusal that came back would be the provider's
    // opinion of a fake id rather than anything about cancelling.
    test.info().annotations.push({
      type: "not exercised",
      description:
        "STRIPE_SECRET_KEY is the template placeholder, so no refund is taken and the date is not given back. It needs a real sk_test_ key and a booking this suite paid for itself: the seeded deposit carries a fabricated payment intent the provider will reject.",
    });
    return;
  }

  await dialog.getByRole("button", { name: "Cancel and refund" }).click();

  await test.step("the booking ends and the money is shown as returned", async () => {
    await expect(page.getByText("cancelled").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Refunded/)).toBeVisible();
  });

  await test.step("the date is bookable again", async () => {
    await page.goto(listing);
    await expect(page.getByText(/Looks free on /)).toBeVisible();
  });
});

/**
 * One business's listing, found the way a person would.
 *
 * The order names the business and not the listing, and a booking holds a date
 * against the business rather than against one of its services — so which of
 * its listings this opens does not matter, only that the availability line on
 * it is about the same held date.
 */
async function openListingForVendor(page: Page, vendorName: string): Promise<string> {
  await page.goto("/services");
  const cards = page.locator("article a[href^='/services/']");
  await expect(cards.first(), "the results page showed no listing").toBeVisible();

  const hrefs = await cards.evaluateAll((links) =>
    links.map((link) => link.getAttribute("href") ?? ""),
  );

  for (const href of hrefs) {
    await page.goto(href);
    // The listing, not its loading boundary: a name looked for on the fallback
    // is a name that is not there yet.
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    // Scoped to the page's own body: the header carries a strip of booked
    // businesses, and this one is on it.
    if (await page.locator("main").getByText(vendorName).first().isVisible()) return href;
  }

  throw new Error(`No listing in the catalogue belongs to ${vendorName}.`);
}
