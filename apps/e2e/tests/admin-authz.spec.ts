import { expect, test } from "@playwright/test";
import { signInAsAdmin } from "../fixtures/auth.js";
import { ADMIN_STATE, ANONYMOUS_STATE, CUSTOMER_STATE } from "../fixtures/state.js";

/**
 * The door, from outside.
 *
 * `packages/core` asserts that no service function answers the wrong person,
 * and `apps/web` asserts that every page and action calls a gate as its first
 * statement. Neither of those runs Next.js. This does: it asks the deployed
 * routing, the proxy, the layout and the page together whether an anonymous
 * visitor and a signed-in non-administrator can reach an admin screen, which is
 * the question a person with a URL is actually asking.
 */

/** Every admin route, as a visitor would type it. */
const ADMIN_ROUTES = [
  "/admin/vendors",
  "/admin/users",
  "/admin/orders",
  "/admin/ops",
  "/admin/email",
] as const;

test.describe("an anonymous visitor", () => {
  test.use({ storageState: ANONYMOUS_STATE });

  for (const route of ADMIN_ROUTES) {
    test(`is sent to the login screen from ${route}`, async ({ page }) => {
      await page.goto(route);

      await expect(page).toHaveURL(/\/login/);
      // And back to where they were going once they are in. Without the `next`
      // parameter the person lands on a default screen and has to find their
      // way back to the row they clicked from an email.
      expect(new URL(page.url()).searchParams.get("next")).toBe(route);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    });
  }

  test("sees nothing of the admin surface in the response itself", async ({ request }) => {
    // The redirect is the visible behaviour; this is the one underneath it. A
    // page that rendered the list and *then* redirected would look identical in
    // a browser and would already have put every account on the wire.
    //
    // Unredirected on purpose: following it lands on the login screen, whose
    // email field is helpfully prefilled with a placeholder address from the
    // seed — so the obvious version of this assertion reads the wrong document
    // and fails on a string that is not a leak.
    const response = await request.get("/admin/users", { maxRedirects: 0 });

    expect(response.status()).toBeGreaterThanOrEqual(300);
    expect(response.status()).toBeLessThan(400);
    expect(response.headers()["location"]).toContain("/login");

    const body = await response.text();
    for (const secret of ["Jonah Tran", "jonah.tran@example.ca", "Bea Varga"]) {
      expect(body).not.toContain(secret);
    }
  });
});

test.describe("a signed-in account that is not an administrator", () => {
  test.use({ storageState: CUSTOMER_STATE });

  for (const route of ADMIN_ROUTES) {
    test(`cannot reach ${route}`, async ({ page }) => {
      await page.goto(route);

      // Refused, however it is phrased: back to the login screen, or a refusal
      // page. What must not happen is the screen rendering.
      await expect(page.getByRole("link", { name: "Automations" })).toHaveCount(0);
      expect(page.url()).not.toContain(route);
    });
  }
});

test.describe("an administrator", () => {
  test.use({ storageState: ADMIN_STATE });

  for (const route of ADMIN_ROUTES) {
    test(`reaches ${route}`, async ({ page }) => {
      await page.goto(route);

      await expect(page).toHaveURL(new RegExp(route.replace("/", "\\/")));
      // The screen, not the error boundary. `heading level=1` alone is true of
      // "That did not load." as well, which is how a broken screen would have
      // passed this.
      await expect(page.getByRole("heading", { name: "That did not load." })).toHaveCount(0);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    });
  }
});

test.describe("signing in", () => {
  test.use({ storageState: ANONYMOUS_STATE });

  test("returns an administrator to the screen they asked for", async ({ page }) => {
    await page.goto("/admin/orders");
    await expect(page).toHaveURL(/\/login\?next=%2Fadmin%2Forders/);

    await signInAsAdmin(page, "/admin/orders");
    await expect(page).toHaveURL(/\/admin\/orders/);
  });
});
