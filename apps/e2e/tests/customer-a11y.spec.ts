import { expect, test } from "@playwright/test";
import { audit, auditable, serious } from "../fixtures/a11y.js";
import {
  customerSession,
  makeEventActive,
  openSeededEvent,
  openSeededListing,
} from "../fixtures/customer.js";

/**
 * The customer surface, for somebody not using a mouse or not seeing the
 * screen.
 *
 * Run at both widths the customer screens are drawn at. The phone width is not
 * a smaller copy of the same problem: the section nav becomes a bottom tab bar,
 * the results grid becomes one column, and contrast against the glass backdrop
 * changes with the layout behind it.
 *
 * Every screen a customer can reach today is here. The checkout, its
 * confirmation and one order's own page are not built yet — a spec that visited
 * them would fail on a route that does not exist, and a spec that listed them
 * and skipped would report as a pass. Add them to `SCREENS` when they land.
 *
 * Only `serious` and `critical` findings fail, for the same reason they are the
 * only ones that fail the admin sweep.
 */

const SCREENS = [
  { name: "the home screen", path: "/" },
  { name: "the results page", path: "/services" },
  { name: "the shortlist", path: "/saved" },
  { name: "the planner", path: "/events" },
  { name: "the new-event form", path: "/events/new" },
  { name: "the orders list", path: "/orders" },
] as const;

test.use(customerSession);

for (const screen of SCREENS) {
  test(`${screen.name} has no serious accessibility failures`, async ({ page }) => {
    await page.goto(screen.path);
    await auditable(page, screen.path);

    expect(serious(await audit(page))).toEqual([]);
  });
}

test("a listing's own page has no serious accessibility failures", async ({ page }) => {
  // With an event active first, so the availability line and the booking card
  // are on the page being audited rather than absent from it. Both read the
  // active event, and neither draws without one.
  await makeEventActive(page, "Sarah's 30th");
  await openSeededListing(page);

  expect(serious(await audit(page))).toEqual([]);
});

test("one event's planner has no serious accessibility failures", async ({ page }) => {
  await openSeededEvent(page);

  expect(serious(await audit(page))).toEqual([]);
});

test("the event edit form has no serious accessibility failures", async ({ page }) => {
  const eventId = await openSeededEvent(page);
  await page.goto(`/events/${eventId}/edit`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  expect(serious(await audit(page))).toEqual([]);
});

test("the login screen has no serious accessibility failures", async ({ page }) => {
  // The screen a customer arrives at with no session, so it is audited without
  // one; signed in, this redirects away.
  await page.context().clearCookies();
  await page.goto("/login");
  await auditable(page, "/login");

  expect(serious(await audit(page))).toEqual([]);
});
