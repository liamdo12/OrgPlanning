import { expect, test } from "@playwright/test";
import {
  customerSession,
  makeEventActive,
  openSeededEvent,
  openSeededListing,
  plannerSlot,
} from "../fixtures/customer.js";

/**
 * Finding a business and getting it onto the planner.
 *
 * The half that exists today runs for real: choosing which event is being
 * planned, reading a date's availability off a listing, shortlisting it, and
 * putting it in the plan. The half that ends in a booking is marked `fixme`
 * rather than skipped — a skipped test reports as a pass in the summary, and a
 * journey that silently stops halfway is exactly the thing this file is for.
 *
 * Every step starts by putting its own subject back to a known state. One
 * reseed covers the whole run and this file runs at two widths, so a second
 * pass would otherwise find the shortlist and the slot already moved and fail
 * for a reason that is not a regression.
 */

const EVENT = "Sarah's 30th";
/** A category with nothing decided on that event, so the slot is free to fill. */
const CATEGORY = "cakes";
const CATEGORY_NAME = "Cakes";

test.use(customerSession);

test("puts a listing found from the catalogue into the plan @smoke", async ({ page }) => {
  await makeEventActive(page, EVENT);
  await openSeededEvent(page);

  const slot = plannerSlot(page, CATEGORY_NAME);
  const remove = slot.getByRole("button", { name: "Remove" });
  if ((await remove.count()) > 0) await remove.click();
  await expect(slot.getByText("Empty")).toBeVisible();

  const slug = await openSeededListing(page, CATEGORY);
  const title = (await page.getByRole("heading", { level: 1 }).textContent())?.trim() ?? "";
  expect(title.length).toBeGreaterThan(0);

  // The booking card says whether the date is free, booked or closed. Which of
  // the three is not this spec's claim; that it answers at all is.
  await expect(
    page.getByText(/Looks free on|Already booked on|The business is closed on/),
  ).toBeVisible();

  const shortlisted = page.getByRole("button", { name: `Saved — ${title}` });
  if ((await shortlisted.count()) > 0) await shortlisted.click();
  await page.getByRole("button", { name: `Save ${title}` }).click();
  await expect(shortlisted).toBeVisible();

  await page.goto("/saved");
  await expect(page.getByRole("link", { name: title })).toBeVisible();

  await page.goto(`/services/${slug}`);
  await page.getByRole("button", { name: `Add ${title} to ${EVENT}` }).click();

  await openSeededEvent(page);
  await expect(plannerSlot(page, CATEGORY_NAME).getByText("In plan")).toBeVisible();
});

test("follows an empty slot to the listings for its category", async ({ page }) => {
  test.fixme(
    true,
    "The planner's Find link names its category in a parameter the results page does not read, so it lands on every service with a warning toast instead of on that category.",
  );

  await openSeededEvent(page);
  await page.getByRole("link", { name: `Find ${CATEGORY}` }).click();
  await expect(page.getByRole("heading", { level: 1, name: CATEGORY_NAME })).toBeVisible();
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
