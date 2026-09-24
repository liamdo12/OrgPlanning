import { expect, type Page } from "@playwright/test";
import { CUSTOMER_STATE } from "./state.js";

/**
 * Reaching the customer's own screens. Auditing one is `a11y.ts`.
 *
 * Sarah is already the suite's customer and already signed in once by the setup
 * project, so nothing here signs anybody in: it reuses the session that was
 * minted through the real login form. What this adds is the part no admin spec
 * needed — getting from a signed-in session to a **seeded event** and a
 * **seeded listing** without either id being written into a spec.
 *
 * Every id is read off the screen. `seedId` is not exported from the database
 * package, and a uuid typed into a test is one that keeps passing until the
 * seed changes and then fails somewhere else entirely.
 */

/** What a spec puts in `test.use(...)` to run as the signed-in customer. */
export const customerSession = { storageState: CUSTOMER_STATE };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The planner for one of this customer's seeded events, and the event's id.
 *
 * `/events` draws the active event rather than a list, so the id is taken from
 * the one control on the screen that carries it — the link to the event's own
 * edit form.
 */
export async function openSeededEvent(page: Page): Promise<string> {
  await page.goto("/events");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  const href = await page.getByRole("link", { name: "Edit event" }).getAttribute("href");
  const eventId = href?.split("/")[2] ?? "";
  expect(eventId, "the planner named no event to open").toMatch(UUID);

  await page.goto(`/events/${eventId}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  return eventId;
}

/**
 * Switches the planner to one named event, through its own form.
 *
 * The active event is an `httpOnly` cookie with no default, written by a server
 * action that checks ownership first — so there is no way to set it from a test
 * except the way a person sets it. Both the availability line on a listing and
 * the booking card read it, which is why a browsing spec has to set it before
 * either means anything.
 */
export async function makeEventActive(page: Page, name: string): Promise<void> {
  await page.goto("/events");

  const switcher = page.locator("#hub-event");
  await expect(switcher, "the planner drew no event switcher").toBeVisible();
  await switcher.selectOption({ label: name });
  await page.getByRole("button", { name: "Switch" }).click();

  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
}

/**
 * One category's row on the planner.
 *
 * Scoped rather than taken by position: a journey that clicked "the first
 * Remove" would be asserting about whichever slot happened to be sorted first,
 * and would keep passing after it changed.
 */
export function plannerSlot(page: Page, categoryName: string) {
  return page.getByRole("listitem").filter({ hasText: categoryName });
}

/**
 * Opens the first seeded listing in a category, and returns its slug.
 *
 * The card's title is its link — the whole card is deliberately not one control
 * — so this follows what a person would click.
 */
export async function openSeededListing(page: Page, category?: string): Promise<string> {
  // `cat`, which is the name the results page reads. Spelling it `category`
  // narrows nothing and draws the "a parameter this screen does not offer"
  // warning instead, so a journey written that way opens whatever listing
  // happened to sort first and still looks like it worked.
  await page.goto(category ? `/services?cat=${encodeURIComponent(category)}` : "/services");

  const first = page.locator("article a[href^='/services/']").first();
  await expect(first, "the results page showed no listing").toBeVisible();

  const href = (await first.getAttribute("href")) ?? "";
  await first.click();
  await page.waitForURL(/\/services\/[^/]+$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  const slug = href.split("/").pop() ?? "";
  expect(slug.length, "the listing card carried no slug").toBeGreaterThan(0);

  return slug;
}

/**
 * Opens one of this customer's bookings, and returns its id and reference.
 *
 * Off the list rather than out of the seed: which bookings exist is the seed's
 * business, and a uuid or a reference typed into a spec passes until the day
 * the seed changes and then fails on a screen that is working.
 */
export async function openSeededOrder(
  page: Page,
): Promise<{ orderId: string; reference: string }> {
  await page.goto("/orders");

  // The row's own control names the booking it opens, which is the only thing
  // on the list carrying the reference in a machine-readable place.
  const view = page.getByRole("link", { name: /^View \S+ with / }).first();
  await expect(view, "the orders list showed no booking").toBeVisible();

  const href = (await view.getAttribute("href")) ?? "";
  const reference = (await view.getAttribute("aria-label"))?.split(" ")[1] ?? "";
  const orderId = href.split("/").pop() ?? "";
  expect(orderId, "the orders list named no booking to open").toMatch(UUID);

  await view.click();
  await page.waitForURL(`**/orders/${orderId}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  return { orderId, reference };
}

/**
 * The checkout for a business the active event has a line waiting on.
 *
 * It plans one first when the planner has none, because the specs run at two
 * widths against a single reseed and the pass before this one may have bought
 * or emptied the slot that was there. Reached by following the planner's own
 * control: the query it carries is the contract between the two screens, and a
 * spec that built the address itself would keep passing after the planner
 * stopped producing it.
 */
export async function openCheckoutForPlannedLine(page: Page): Promise<void> {
  await page.goto("/events");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  // The row's control, not the panel's "Check out 1 item in plan" — the two
  // lead to the same screen, and the row is the one a slot always has.
  const checkout = page.getByRole("link", { name: "Check out", exact: true }).first();
  if ((await checkout.count()) === 0) await planALine(page);

  await expect(checkout, "the planner offered nothing to check out").toBeVisible();
  await checkout.click();
  await page.waitForURL(/\/checkout\?/);
}

/** Puts the first listing of an empty slot's category into the active event. */
async function planALine(page: Page): Promise<void> {
  const eventName = (await page.getByRole("heading", { level: 1 }).textContent())?.trim() ?? "";

  // The planner draws an event without the cookie being set; the listing's
  // booking card does not, and offers "Choose an event" instead of the button
  // this follows. So the event the planner is showing is made the active one.
  await makeEventActive(page, eventName);

  const find = page.getByRole("link", { name: /^Find / }).first();
  await expect(find, "the planner had no empty slot left to fill").toBeVisible();
  await find.click();
  await page.waitForURL(/\/services\?cat=/);

  const listing = page.locator("article a[href^='/services/']").first();
  await expect(listing, "the category the planner named had no listing").toBeVisible();
  await listing.click();
  await page.waitForURL(/\/services\/[^/]+$/);

  const title = (await page.getByRole("heading", { level: 1 }).textContent())?.trim() ?? "";
  await page.getByRole("button", { name: `Add ${title} to ${eventName}` }).click();
  await page.waitForURL(/\/events/);
}
