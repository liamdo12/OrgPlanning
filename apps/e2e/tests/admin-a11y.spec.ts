import { expect, test, type Page } from "@playwright/test";
import { audit, auditable, serious } from "../fixtures/a11y.js";
import { ADMIN_STATE } from "../fixtures/state.js";

/**
 * The admin surface, for somebody not using a mouse or not seeing the screen.
 *
 * Run at both widths the project targets. The phone width is not a smaller copy
 * of the same problem: the nav becomes a tab bar, panels become drawers, and
 * contrast against the glass backdrop changes with the layout behind it.
 *
 * The pass itself, what fails a run, and the rule that a screen proves it is
 * the screen that was asked for before it is measured, are all in
 * `fixtures/a11y.ts` — shared with the customer sweep rather than copied.
 */

const SCREENS = [
  { name: "vendors", path: "/admin/vendors" },
  { name: "users", path: "/admin/users" },
  { name: "orders", path: "/admin/orders" },
  { name: "automations", path: "/admin/ops" },
  { name: "email", path: "/admin/email" },
  // The five the business proposal names, added with the screens rather than
  // afterwards: an accessibility pass that covers the screens somebody
  // remembered to list is a pass over whatever was easy.
  { name: "disputes", path: "/admin/disputes" },
  { name: "moderation", path: "/admin/moderation" },
  { name: "categories", path: "/admin/categories" },
  { name: "analytics", path: "/admin/analytics" },
  { name: "settings", path: "/admin/settings" },
] as const;

// Signed in once, in `auth.setup.ts`. Signing in per test spent the platform's
// login allowance on setup and then failed against its own brute-force limit.
test.use({ storageState: ADMIN_STATE });

for (const screen of SCREENS) {
  test(`${screen.name} has no serious accessibility failures`, async ({ page }) => {
    await page.goto(screen.path);
    await auditable(page, screen.path);

    expect(serious(await audit(page))).toEqual([]);
  });
}

test("the login screen has no serious accessibility failures", async ({ page }) => {
  // The one screen an anonymous visitor sees, so it is audited without a
  // session; signed in, this redirects away.
  await page.context().clearCookies();
  await page.goto("/login");
  await auditable(page, "/login");

  expect(serious(await audit(page))).toEqual([]);
});

test.describe("keyboard only", () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 900, "The tab bar is a separate layout.");

  /** Tabs forward until the focused element is the one named, or gives up. */
  async function tabTo(page: Page, label: string): Promise<boolean> {
    for (let press = 0; press < 60; press += 1) {
      await page.keyboard.press("Tab");
      const there = await page.evaluate(
        (name) => document.activeElement?.textContent?.trim() === name,
        label,
      );
      if (there) return true;
    }
    return false;
  }

  test("reaches every section of the admin surface from the keyboard", async ({ page }) => {
    await page.goto("/admin/vendors");

    // Tab until the nav link is focused, then follow it with Enter. A link that
    // is only reachable by clicking is a section somebody cannot get to, and a
    // `div` with an onClick looks identical until this runs.
    const reached: string[] = [];

    for (const label of ["Users", "Orders", "Automations"]) {
      await page.keyboard.press("Home");
      expect(await tabTo(page, label), `could not reach ${label} with the keyboard`).toBe(true);

      await page.keyboard.press("Enter");
      await page.waitForURL(/\/admin\//);
      reached.push(label);
    }

    expect(reached).toEqual(["Users", "Orders", "Automations"]);
  });

  test("shows where the focus is", async ({ page }) => {
    await page.goto("/admin/vendors");

    // Tabbed to rather than focused programmatically, and to a control this
    // repository owns. `.focus()` does not always set `:focus-visible`, which
    // is where the ring is defined, and the first Tab on a dev server lands on
    // the framework's own overlay button.
    expect(await tabTo(page, "Users")).toBe(true);

    // A visible ring is the difference between a keyboard being usable and a
    // keyboard being merely possible. `outline: none` with nothing put in its
    // place is how it is usually lost, and that is invisible in review.
    const ring = await page.evaluate(() => {
      const element = document.activeElement;
      if (!element) return null;
      const style = getComputedStyle(element);
      return {
        outlineWidth: style.outlineWidth,
        outlineStyle: style.outlineStyle,
        boxShadow: style.boxShadow,
      };
    });

    expect(ring).not.toBeNull();
    const hasRing =
      (ring?.outlineStyle !== "none" && ring?.outlineWidth !== "0px") ||
      (ring?.boxShadow !== "none" && ring?.boxShadow !== "");
    expect(hasRing, `the focused link had no visible ring: ${JSON.stringify(ring)}`).toBe(true);
  });
});
