import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";
import { CUSTOMER_STATE } from "./state.js";

/**
 * Reaching the customer's own screens, and auditing them.
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
 * axe over one page.
 *
 * Next's development overlay injects a root of its own, and its findings would
 * be reported against every screen while being unfixable from this repository.
 */
export async function audit(page: Page): ReturnType<AxeBuilder["analyze"]> {
  return new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .exclude("nextjs-portal")
    .analyze();
}

/**
 * The findings that fail a run.
 *
 * axe's `moderate` bucket is largely advisory, and a suite that fails on all
 * four is a suite somebody switches off — which is how the two that matter stop
 * being checked.
 */
export function serious(results: Awaited<ReturnType<typeof audit>>): string[] {
  return results.violations
    .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
    .map((violation) => `${violation.id}: ${violation.help} (${violation.nodes.length})`);
}

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
 * Opens the first seeded listing in a category, and returns its slug.
 *
 * The card's title is its link — the whole card is deliberately not one control
 * — so this follows what a person would click.
 */
export async function openSeededListing(page: Page, category?: string): Promise<string> {
  await page.goto(category ? `/services?category=${encodeURIComponent(category)}` : "/services");

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
