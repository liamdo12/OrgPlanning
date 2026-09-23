import { expect, test } from "@playwright/test";
import { customerSession, makeEventActive, openSeededEvent } from "../fixtures/customer.js";

/**
 * Taking something back.
 *
 * Two different acts, and the customer sees both: emptying a slot they had only
 * chosen, and cancelling a booking they had paid a deposit on. The first is
 * built and runs here. The second needs one order's own page, which does not
 * exist yet, so it is `fixme` rather than skipped — a skipped test reports as a
 * pass.
 *
 * When the cancelling half is written, what it has to establish is not only
 * that the booking ends: the date has to go back, so the same listing reads
 * free again on the day it was holding.
 */

test.use(customerSession);

test("empties a slot the customer had only chosen", async ({ page }) => {
  await makeEventActive(page, "Sarah's 30th");
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

test("cancels a booking inside its free window and gets the money back", async ({ page }) => {
  test.fixme(true, "One order's own page, which is where a customer cancels, is not built yet.");

  await page.goto("/orders");
});

test("gives the date back when a booking is cancelled", async ({ page }) => {
  test.fixme(true, "Nothing can cancel a booking from the customer's side yet.");

  await page.goto("/orders");
});
