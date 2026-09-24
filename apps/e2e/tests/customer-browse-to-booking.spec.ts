import { expect, test } from "@playwright/test";
import {
  customerSession,
  makeEventActive,
  openCheckoutForPlannedLine,
  openSeededEvent,
  openSeededListing,
  plannerSlot,
} from "../fixtures/customer.js";
import { stripeConfigured } from "../fixtures/seed.js";

/**
 * Finding a business and getting it onto the planner, and then paying for it.
 *
 * Every step runs for real except the one that moves money: choosing which
 * event is being planned, reading a date's availability off a listing,
 * shortlisting it, putting it in the plan, following an empty slot to its own
 * category, opening the checkout the plan produced, and reading a finished
 * booking back off the planner and the orders list.
 *
 * **The card is not charged here** while `STRIPE_SECRET_KEY` is the template's
 * placeholder. The step is not skipped and not marked unbuilt — both of those
 * report as something other than what is true. It pushes an annotation, which
 * comes out in the run's own report, and stops at the point where a real key
 * would be needed.
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
  await makeEventActive(page, EVENT);
  await openSeededEvent(page);

  // Whichever slot is empty when this runs, rather than a named one: the step
  // before this fills a slot, and at the second width it has already run once.
  const find = page.getByRole("link", { name: /^Find / }).first();
  await expect(find, "the planner had no empty slot to follow").toBeVisible();
  const category = ((await find.textContent()) ?? "").trim().replace(/^Find /, "");

  await find.click();
  await page.waitForURL(/\/services\?cat=/);

  // The results page names the category it filtered to. It used to be handed a
  // parameter it does not read, and answered by listing everything with a
  // warning on top — which looks like a working link until you read the heading.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    new RegExp(`^${category}$`, "i"),
  );
  await expect(page.getByText(/this screen does not offer/)).toHaveCount(0);
});

test("buys the slot it put in the plan", async ({ page }) => {
  await makeEventActive(page, EVENT);
  await openCheckoutForPlannedLine(page);

  await expect(page.getByRole("heading", { level: 1, name: "Confirm and pay" })).toBeVisible();

  // What is bought comes from the plan, so the summary is the plan's line and
  // its total, not anything this spec typed.
  const pay = page.getByRole("button", { name: /^Pay deposit C\$/ });
  await expect(pay).toBeVisible();
  // Nothing can be charged before the agreement is ticked, whatever else is
  // ready. That is the one rule on this screen that does not need a provider.
  await expect(pay).toBeDisabled();

  if (!stripeConfigured()) {
    // Not silently passed over: the annotation is in the run's report. With the
    // placeholder key the provider's card field never mounts, so there is
    // nothing to type a card into and the button stays disabled for a second
    // reason — which would make "it is disabled" a claim about the wrong thing.
    test.info().annotations.push({
      type: "not exercised",
      description:
        "STRIPE_SECRET_KEY is the template placeholder, so the card field does not mount and no deposit is taken. Set a real sk_test_ key, with the pk_test_ key that matches it, to exercise the payment and the confirmation it lands on.",
    });
    return;
  }

  await page.getByRole("checkbox", { name: /^I agree to the vendor/ }).check();

  // The provider's own field, in its own frame. Test mode, test card.
  const card = page.frameLocator("iframe[name^='__privateStripeFrame']").first();
  await card.getByLabel("Card number").fill("4242424242424242");
  await card.getByLabel(/Expir/).fill("12" + String(new Date().getFullYear() + 2).slice(-2));
  await card.getByLabel("CVC").fill("123");
  await card.getByLabel(/ZIP|Postal/).fill("M5V 2T6");

  await expect(pay).toBeEnabled();
  await pay.click();

  await page.waitForURL(/\/orders\/[0-9a-f-]+\/confirmed$/, { timeout: 60_000 });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/is booked\.|^Paying /);
});

test("shows the finished booking on the planner and in the orders list", async ({ page }) => {
  await makeEventActive(page, EVENT);
  await openSeededEvent(page);

  // Whatever is booked on this event when the step runs. With no payment
  // provider configured that is a booking the seed made rather than one this
  // run bought, and the three screens it crosses are the same either way.
  const booked = page.getByRole("listitem").filter({ hasText: "Booked" }).first();
  await expect(booked, "the planner showed no finished booking").toBeVisible();

  const reference = ((await booked.innerText()).match(/\b[A-Z]{2}-\d+\b/) ?? [])[0] ?? "";
  expect(reference, "the booked slot named no order").not.toBe("");

  await booked.getByRole("link", { name: "View order" }).click();
  await page.waitForURL(/\/orders\/[0-9a-f-]+$/);
  await expect(page.getByText(reference).first()).toBeVisible();

  await page.goto("/orders");
  await expect(page.getByRole("link", { name: `View ${reference}`, exact: false })).toBeVisible();
});
