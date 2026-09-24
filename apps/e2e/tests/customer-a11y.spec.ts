import { expect, test, type Locator, type Page } from "@playwright/test";
import { audit, auditable, serious } from "../fixtures/a11y.js";
import {
  customerSession,
  makeEventActive,
  openCheckoutForPlannedLine,
  openSeededEvent,
  openSeededListing,
  openSeededOrder,
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
 * **Every screen state a customer can reach is named here**, including the two
 * a list has — a populated one and an empty one — because an empty screen is
 * mostly a sentence and passes a pass its populated form would fail. The
 * checkout is audited **without its card field**: mounting the provider's
 * element needs a real publishable key, and the placeholder this environment
 * carries renders the screen around an iframe that never arrives. What this
 * sweep says about `/checkout` stops at the edge of that field.
 *
 * Only `serious` and `critical` findings fail, for the same reason they are the
 * only ones that fail the admin sweep.
 */

const SCREENS: ReadonlyArray<{
  name: string;
  path: string;
  /** Something only the screen **with rows on it** draws. */
  shows: (page: Page) => Locator;
}> = [
  {
    name: "the home screen",
    path: "/",
    shows: (page) => page.locator("a[href^='/services?cat=']").first(),
  },
  {
    name: "the results page",
    path: "/services",
    shows: (page) => page.locator("article a[href^='/services/']").first(),
  },
  {
    name: "the shortlist",
    path: "/saved",
    shows: (page) => page.locator("a[href^='/services/']").first(),
  },
  {
    name: "the planner",
    path: "/events",
    shows: (page) => page.getByRole("listitem").first(),
  },
  {
    name: "the new-event form",
    path: "/events/new",
    shows: (page) => page.getByRole("button", { name: "Create event" }),
  },
  {
    name: "the orders list",
    path: "/orders",
    shows: (page) => page.getByRole("link", { name: /^View \S+ with / }).first(),
  },
];

test.use(customerSession);

for (const screen of SCREENS) {
  test(`${screen.name} has no serious accessibility failures`, async ({ page }) => {
    await page.goto(screen.path);
    await auditable(page, screen.path);
    await expect(screen.shows(page), `${screen.path} had nothing on it to audit`).toBeVisible();

    expect(serious(await audit(page))).toEqual([]);
  });
}

test("a listing's own page has no serious accessibility failures", async ({ page }) => {
  // With an event active first, so the availability line and the booking card
  // are on the page being audited rather than absent from it. Both read the
  // active event, and neither draws without one.
  await makeEventActive(page, "Sarah's 30th");
  const slug = await openSeededListing(page);
  await auditable(page, `/services/${slug}`);

  expect(serious(await audit(page))).toEqual([]);
});

test("one event's planner has no serious accessibility failures", async ({ page }) => {
  const eventId = await openSeededEvent(page);
  await auditable(page, `/events/${eventId}`);

  expect(serious(await audit(page))).toEqual([]);
});

test("the event edit form has no serious accessibility failures", async ({ page }) => {
  const eventId = await openSeededEvent(page);
  await page.goto(`/events/${eventId}/edit`);
  await auditable(page, `/events/${eventId}/edit`);

  expect(serious(await audit(page))).toEqual([]);
});

test("the checkout has no serious accessibility failures", async ({ page }) => {
  await openCheckoutForPlannedLine(page);
  await auditable(page, "/checkout");

  // The agreement and the figures, which is the part of this screen that is
  // this repository's. The card field belongs to the provider and is absent
  // without a real publishable key.
  await expect(page.getByRole("button", { name: /^Pay deposit/ })).toBeVisible();

  expect(serious(await audit(page))).toEqual([]);
});

test("one booking's own page has no serious accessibility failures", async ({ page }) => {
  const { orderId } = await openSeededOrder(page);
  await auditable(page, `/orders/${orderId}`);

  expect(serious(await audit(page))).toEqual([]);
});

test("the screen a finished booking lands on has no serious accessibility failures", async ({
  page,
}) => {
  // Reached for a booking that is already paid rather than by paying for one:
  // the screen is the order's, not the payment's, and it draws for any booking
  // this customer owns.
  const { orderId } = await openSeededOrder(page);
  await page.goto(`/orders/${orderId}/confirmed`);
  await auditable(page, `/orders/${orderId}/confirmed`);

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
