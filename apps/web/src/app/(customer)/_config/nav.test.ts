import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CUSTOMER_NAV_SIGNED_IN,
  CUSTOMER_NAV_SIGNED_OUT,
  activeTabId,
  customerNav,
} from "./nav.js";

/**
 * The navigation, against the routes that actually exist.
 *
 * The rule this protects is "visibly deferred, never a link to a 404". It is
 * easy to state and easy to break in the direction that looks like progress: a
 * screen gets planned, somebody adds the tab, and the tab ships first. So the
 * tree is read rather than trusted — every destination is checked for a
 * `page.tsx`, and an item with no destination has to say why it has none.
 */

const groupRoot = fileURLToPath(new URL("..", import.meta.url));

/** Does a route exist under `(customer)` for this href? */
function hasPage(href: string): boolean {
  const segments = href.split("/").filter(Boolean);
  return existsSync(join(groupRoot, ...segments, "page.tsx"));
}

const everyItem = [...CUSTOMER_NAV_SIGNED_OUT, ...CUSTOMER_NAV_SIGNED_IN];

describe("customer navigation", () => {
  it("draws the prototype's own two sets", () => {
    // Line 1980 signed out, line 1981 signed in.
    expect(CUSTOMER_NAV_SIGNED_OUT.map((item) => item.label)).toEqual(["Explore", "Services"]);
    expect(CUSTOMER_NAV_SIGNED_IN.map((item) => item.label)).toEqual([
      "Explore",
      "Saved",
      "Events",
      "Calendar",
    ]);
  });

  it.each(everyItem.filter((item) => item.href).map((item) => [item.label, item.href!] as const))(
    "%s points at a route that exists",
    (_label, href) => {
      expect(hasPage(href), `no page for ${href}`).toBe(true);
    },
  );

  it("gives every item without a destination a reason", () => {
    for (const item of everyItem) {
      if (item.href) continue;
      expect(item.deferred, `${item.label} is deferred with no explanation`).toBeTruthy();
    }
  });

  it("never marks an item deferred and linkable at once", () => {
    // Both would draw a dimmed control that navigates, which is the worst of
    // the two readings: it looks unavailable and it works.
    for (const item of everyItem) {
      expect(item.deferred && item.href, item.label).toBeFalsy();
    }
  });

  it("defers Calendar, which is a screen this plan does not build", () => {
    const calendar = CUSTOMER_NAV_SIGNED_IN.find((item) => item.id === "calendar");

    expect(calendar?.href).toBeUndefined();
    expect(calendar?.deferred).toContain("not built");
    // It still carries an icon, because it is drawn rather than hidden.
    expect(calendar?.icon).toBeTruthy();
  });

  it("gives every tab an icon, since the phone's bar draws one per tab", () => {
    for (const item of everyItem) {
      expect(item.icon, item.label).toBeTruthy();
    }
  });
});

describe("which tab is current", () => {
  it("matches the front door exactly and not as a prefix", () => {
    expect(activeTabId("/", false)).toBe("explore");
    expect(activeTabId("/saved", true)).toBe("saved");
  });

  it("keeps a nested route under its own tab", () => {
    expect(activeTabId("/services/bloom-and-co", false)).toBe("services");
    expect(activeTabId("/events/abc", true)).toBe("events");
  });

  it("folds the browse screens under Explore once signed in", () => {
    // Signed in there is no Services tab, and a person on the results screen is
    // still exploring. Line 2035 groups them the same way.
    expect(activeTabId("/services", true)).toBe("explore");
    expect(activeTabId("/services/bloom-and-co", true)).toBe("explore");
  });

  it("does not fold them signed out, where Services is a tab of its own", () => {
    expect(activeTabId("/services", false)).toBe("services");
  });

  it("marks nothing for a route that is on neither bar", () => {
    expect(activeTabId("/login", false)).toBeUndefined();
  });

  it("answers with an id the rendered set actually contains", () => {
    // The renderers compare this against their own items; an id from the other
    // set would light up nothing and look like a bug in the bar.
    for (const signedIn of [true, false]) {
      const ids = new Set(customerNav(signedIn).map((item) => item.id));
      for (const path of ["/", "/services", "/saved", "/events", "/orders", "/checkout"]) {
        const active = activeTabId(path, signedIn);
        if (active) expect(ids.has(active), `${path} → ${active}`).toBe(true);
      }
    }
  });
});
