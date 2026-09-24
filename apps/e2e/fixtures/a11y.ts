import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

/**
 * One axe pass, shared by every sweep in the suite.
 *
 * It lives here rather than in either spec because the two halves of it are
 * hard-won and were, for a while, only in one of them: the settle-wait below,
 * and the rule that a screen is audited only after it has proved it is the
 * screen that was asked for. Copied into a second file, one copy gets the next
 * fix and the other keeps reporting green.
 */

/**
 * axe over one page, once it has stopped moving.
 *
 * Next's development overlay injects a root of its own, and its findings would
 * be reported against every screen while being unfixable from this repository.
 */
export async function audit(page: Page): ReturnType<AxeBuilder["analyze"]> {
  // Audited once the screen has settled. Cards enter on a 0.3s fade, and
  // `opacity` composites through every child — so text that passes at rest is
  // measured part-transparent and reported as a contrast failure, on a
  // different number of elements every run depending on where the frame fell.
  // An animation that repeats for ever is excluded rather than waited on,
  // because waiting for it is waiting for nothing.
  await page.waitForFunction(() =>
    document.getAnimations().every((animation) => {
      if (animation.playState !== "running") return true;
      return animation.effect?.getComputedTiming().iterations === Number.POSITIVE_INFINITY;
    }),
  );

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
    .map((violation) => {
      // The offending elements, not only how many. A contrast failure reported
      // as a number sends whoever reads it hunting through a whole screen for
      // the pair that broke.
      const where = violation.nodes
        .slice(0, 3)
        .map((node) => node.target.join(" "))
        .join(" | ");
      return `${violation.id}: ${violation.help} (${violation.nodes.length}) — ${where}`;
    });
}

/**
 * The screen under the audit is the screen that was asked for.
 *
 * Every screen that needs a session answers with the login page when the
 * session has quietly gone, and the login page has an `h1` and passes axe — so
 * a sweep without this reports one clean screen as ten. It happened: the stored
 * customer session was dead for two phases and ten audits were of `/login`.
 */
export async function auditable(page: Page, path: string): Promise<void> {
  expect(new URL(page.url()).pathname, `${path} did not render`).toBe(path);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}
