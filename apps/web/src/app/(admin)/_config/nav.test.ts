import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ADMIN_MORE_ITEMS,
  ADMIN_NAV,
  ADMIN_NAV_ITEMS,
  ADMIN_TAB_ITEMS,
  activeSectionId,
} from "./nav";

/**
 * The navigation has two claims to keep, and they are different claims.
 *
 * The prototype's own four sections — `routesFor('admin')` at line 1979 returns
 * Vendors, Users, Orders and Automations, in that order — are what the phone's
 * tab row shows, with the prototype's own icons. A fifth tab or a reordering
 * there is a parity break nobody notices in a screenshot.
 *
 * The desktop list is wider, because the admin surface is wider than the
 * prototype drew: five capabilities the business proposal names were added
 * afterwards. Those are recorded in `docs/design-gaps.md` and grouped as
 * validation agreed (V-04), and the assertions below are about the grouping
 * rather than about parity, because there is nothing to be parity with.
 */

describe("admin navigation", () => {
  it("shows the prototype's four sections on a phone, in the prototype's order", () => {
    expect(ADMIN_TAB_ITEMS.map((item) => item.label)).toEqual([
      "Vendors",
      "Users",
      "Orders",
      "Automations",
    ]);
  });

  it("gives each of those the prototype's own icon", () => {
    // The paths themselves, from `ICONS` at lines 2032–2035 — not merely "a
    // string shaped like a path", which a transposed coordinate would pass.
    expect(ADMIN_TAB_ITEMS.map((item) => item.icon)).toEqual([
      "M4 9.5h16V20H4zM4 9.5 6 4h12l2 5.5M9.5 20v-5h5v5",
      "M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3.5 20c0-3 2.5-4.6 5.5-4.6s5.5 1.6 5.5 4.6M16.5 6.4a3 3 0 0 1 0 5.6M18 15.6c1.8.6 3 1.9 3 4",
      "M6 3.5h12v16.5l-2.6-1.5-2.6 1.5-2.6-1.5L7.6 20 6 19V3.5zM9 8.5h6M9 12.5h4",
      "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 8v4.4l3 1.8",
    ]);
  });

  it("puts the screens the prototype never drew behind More", () => {
    expect(ADMIN_MORE_ITEMS.map((item) => item.label)).toEqual([
      "Disputes",
      "Moderation",
      "Categories",
      "Analytics",
      "Settings",
    ]);
  });

  it("reaches every section one way or the other", () => {
    // The two phone lists together have to be the whole desktop list, or a
    // screen is reachable on one and not the other — which is the failure the
    // single source of truth exists to prevent.
    expect([...ADMIN_TAB_ITEMS, ...ADMIN_MORE_ITEMS].map((item) => item.id).sort()).toEqual(
      ADMIN_NAV_ITEMS.map((item) => item.id).sort(),
    );
  });

  it("keeps email out of the section lists", () => {
    // Reached from the header and from the Users screen (lines 398 and 1663).
    // Still true now the surface has grown: nothing about adding Moderation
    // changed where Email is reached from.
    expect(ADMIN_NAV_ITEMS.some((item) => item.href.includes("email"))).toBe(false);
  });

  it("gives every item a unique id", () => {
    const ids = ADMIN_NAV_ITEMS.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
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

  it("is grouped as validation agreed", () => {
    expect(ADMIN_NAV.map((group) => group.id)).toEqual(["operations", "platform"]);
    expect(ADMIN_NAV[0]?.items.map((item) => item.id)).toEqual([
      "vendors",
      "users",
      "orders",
      "disputes",
      "moderation",
    ]);
    expect(ADMIN_NAV[1]?.items.map((item) => item.id)).toEqual([
      "ops",
      "categories",
      "analytics",
      "settings",
    ]);
  });

  it("marks the section a path belongs to, including its children", () => {
    expect(activeSectionId("/admin/vendors")).toBe("vendors");
    expect(activeSectionId("/admin/vendors/bloom-and-co")).toBe("vendors");
    expect(activeSectionId("/admin/ops")).toBe("ops");
    expect(activeSectionId("/admin/moderation")).toBe("moderation");
  });

  it("marks nothing for a path outside the sections", () => {
    // `/admin/email` is reachable but is not a section; nothing should light up.
    expect(activeSectionId("/admin/email")).toBeUndefined();
    expect(activeSectionId("/login")).toBeUndefined();
  });
});
