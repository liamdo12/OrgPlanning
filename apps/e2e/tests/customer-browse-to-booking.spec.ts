import { expect, test } from "@playwright/test";
import {
  customerSession,
  makeEventActive,
  openSeededEvent,
  openSeededListing,
} from "../fixtures/customer.js";

/**
 * Finding a business and getting it onto the planner.
 *
 * The half that exists today runs for real: choosing which event is being
 * planned, reading a date's availability off a listing, shortlisting it, and
 * putting it in the plan. The half that ends in a booking is marked `fixme`
 * rather than skipped — a skipped test reports as a pass in the summary, and a
 * journey that silently stops halfway is exactly the thing this file is for.
 */

const EVENT = "Sarah's 30th";
/** A category with nothing decided on that event, so the slot is free to fill. */
const CATEGORY = "cakes";

test.use(customerSession);

test("puts a listing found from the catalogue into the plan @smoke", async ({ page }) => {
  await makeEventActive(page, EVENT);

  // Counted before, because the seeded planner already has a slot in plan.
  // "One Remove control is on the screen" would have been true before the
  // journey ran.
  await openSeededEvent(page);
  const inPlanBefore = await page.getByRole("button", { name: "Remove" }).count();

  const slug = await openSeededListing(page, CATEGORY);
  const title = (await page.getByRole("heading", { level: 1 }).textContent())?.trim() ?? "";
  expect(title.length).toBeGreaterThan(0);

  // The booking card says whether the date is free, booked or closed. Which of
  // the three is not this spec's claim; that it answers at all is.
  await expect(
    page.getByText(/Looks free on|Already booked on|The business is closed on/),
  ).toBeVisible();

  await page.getByRole("button", { name: `Save ${title}` }).click();
  await expect(page.getByRole("button", { name: `Saved — ${title}` })).toBeVisible();

  await page.goto("/saved");
  await expect(page.getByRole("link", { name: title })).toBeVisible();

  await page.goto(`/services/${slug}`);
  await page.getByRole("button", { name: `Add ${title} to ${EVENT}` }).click();

  await openSeededEvent(page);
  await expect(page.getByRole("button", { name: "Remove" })).toHaveCount(inPlanBefore + 1);
});

test("buys the slot it put in the plan", async ({ page }) => {
  test.fixme(
    true,
    "The checkout and its confirmation are not built yet; the planner's Check out control is drawn disabled with that reason on it.",
  );

  await openSeededEvent(page);
});

test("shows the finished booking on the planner and in the orders list", async ({ page }) => {
  test.fixme(true, "There is no order detail screen to reach from either place yet.");

  await page.goto("/orders");
});
