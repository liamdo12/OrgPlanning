import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ADMIN_NAV, ADMIN_NAV_ITEMS, activeSectionId } from "./nav";

/**
 * The navigation is the one thing in the admin surface that has to match the
 * prototype exactly: `routesFor('admin')` at line 1979 returns Vendors, Users,
 * Orders and Automations, in that order, and a fifth tab or a reordering is a
 * parity break nobody notices in a screenshot.
 */

describe("admin navigation", () => {
  it("is the prototype's four sections, in the prototype's order", () => {
    expect(ADMIN_NAV_ITEMS.map((item) => item.label)).toEqual([
      "Vendors",
      "Users",
      "Orders",
      "Automations",
    ]);
  });

  it("keeps email out of the tab row", () => {
    // Reached from the header and from the Users screen (lines 398 and 1663).
    expect(ADMIN_NAV_ITEMS.some((item) => item.href.includes("email"))).toBe(false);
  });

  it("gives every item a unique id and the prototype's own icon", () => {
    const ids = ADMIN_NAV_ITEMS.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);

    // The paths themselves, from `ICONS` at lines 2032–2035 — not merely "a
    // string shaped like a path", which a transposed coordinate would pass.
    expect(ADMIN_NAV_ITEMS.map((item) => item.icon)).toEqual([
      "M4 9.5h16V20H4zM4 9.5 6 4h12l2 5.5M9.5 20v-5h5v5",
      "M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3.5 20c0-3 2.5-4.6 5.5-4.6s5.5 1.6 5.5 4.6M16.5 6.4a3 3 0 0 1 0 5.6M18 15.6c1.8.6 3 1.9 3 4",
      "M6 3.5h12v16.5l-2.6-1.5-2.6 1.5-2.6-1.5L7.6 20 6 19V3.5zM9 8.5h6M9 12.5h4",
      "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 8v4.4l3 1.8",
    ]);
  });

  it("points every item at a route that exists", () => {
    // A rename would otherwise fail silently at runtime — the nav would render
    // and every link would 404.
    for (const item of ADMIN_NAV_ITEMS) {
      // `..` is the route group directory: `(admin)` is a folder but not a URL
      // segment, so the href hangs off it directly.
      const page = fileURLToPath(new URL(`..${item.href}/page.tsx`, import.meta.url));
      expect(existsSync(page), item.href).toBe(true);
    }
  });

  it("is grouped, so later sections have somewhere to go", () => {
    expect(ADMIN_NAV.map((group) => group.id)).toEqual(["operations", "platform"]);
  });

  it("marks the section a path belongs to, including its children", () => {
    expect(activeSectionId("/admin/vendors")).toBe("vendors");
    expect(activeSectionId("/admin/vendors/bloom-and-co")).toBe("vendors");
    expect(activeSectionId("/admin/ops")).toBe("ops");
  });

  it("marks nothing for a path outside the sections", () => {
    // `/admin/email` is reachable but is not a section; nothing should light up.
    expect(activeSectionId("/admin/email")).toBeUndefined();
    expect(activeSectionId("/login")).toBeUndefined();
  });
});
