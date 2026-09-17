/**
 * Events, orders and the quote request, transcribed from the prototype.
 *
 * Every instant is an OFFSET from the seed anchor, never a literal date. The
 * prototype's four clock states are "now", "+48h", "event−14d" and "event+72h";
 * if the seed wrote 2026-09-15 into the database, every one of those states
 * would be in the past within a year and the demo would stop meaning anything.
 *
 * Citations are line numbers in `design/Event Marketplace Glass.dc.html`.
 */

import { PLATFORM_SETTINGS } from "./reference.js";

/** Offsets in whole days from the anchor. */
export const DAYS = {
  /** "Sarah's 30th" is 2027-03-20 and the anchor is 2026-09-15. Line 1887. */
  sarahsThirtieth: 186,
  okaforWedding: -120,
  /**
   * Ada's future booking. The prototype's third clock state charges the
   * balances of TO-4192 and TO-4207 on the same day (line 2157), and the
   * balance date is always event minus fourteen days — so TO-4207's event has
   * to fall on the same day as Sarah's 30th.
   */
  okaforAnniversary: 186,
  officeSocial: 95,
  babyShower: -30,
  corporateLaunch: -60,
} as const;

/**
 * Rules that place every scheduled instant and every amount.
 *
 * Derived from `PLATFORM_SETTINGS` rather than restated, so the numbers the
 * seed computes with and the numbers it writes into `app.planning_org_platform_settings`
 * cannot drift apart — the settings row is what a service reads at runtime.
 */
function setting(key: string): number {
  const found = PLATFORM_SETTINGS.find((entry) => entry.key === key);
  if (typeof found?.value !== "number") {
    throw new Error(`Platform setting ${key} is missing or is not a number.`);
  }
  return found.value;
}

export const RULES = {
  coolingWindowHours: setting("cooling_window_hours"),
  balanceLeadDays: setting("balance_lead_days"),
  autoCompleteHours: setting("auto_complete_hours"),
  balanceGraceHours: setting("balance_grace_hours"),
  depositBps: setting("deposit_bps"),
  commissionBps: setting("commission_bps"),
  hstBps: setting("hst_bps"),
} as const;

export const EVENTS = [
  {
    key: "sarahs-30th",
    ownerKey: "sarah",
    name: "Sarah's 30th",
    dayOffset: DAYS.sarahsThirtieth,
    startTime: "17:00",
    venueName: "Liberty Village loft",
    neighbourhoodSlug: "liberty-village",
    guestCount: 60,
    budget: 400_000n,
  },
  {
    key: "okafor-wedding",
    ownerKey: "ada",
    name: "Okafor wedding",
    dayOffset: DAYS.okaforWedding,
    startTime: "15:00",
    venueName: "Casa Loma",
    neighbourhoodSlug: "casa-loma",
    guestCount: 120,
    budget: 1_800_000n,
  },
  {
    key: "okafor-anniversary",
    ownerKey: "ada",
    name: "Okafor anniversary",
    dayOffset: DAYS.okaforAnniversary,
    startTime: "18:00",
    venueName: "Evergreen Brick Works",
    neighbourhoodSlug: "evergreen-brick-works",
    guestCount: 120,
    budget: 600_000n,
  },
  {
    key: "office-social",
    ownerKey: "sarah",
    name: "Office social",
    dayOffset: DAYS.officeSocial,
    startTime: "18:30",
    venueName: "Steam Whistle Brewing",
    neighbourhoodSlug: "steam-whistle-brewing",
    guestCount: 80,
    budget: 500_000n,
  },
  {
    key: "baby-shower",
    ownerKey: "sarah",
    name: "Baby shower",
    dayOffset: DAYS.babyShower,
    startTime: "14:00",
    venueName: "Leslieville home",
    neighbourhoodSlug: "leslieville",
    guestCount: 25,
    budget: 120_000n,
  },
  {
    key: "corporate-launch",
    ownerKey: "ada",
    name: "Corporate launch",
    dayOffset: DAYS.corporateLaunch,
    startTime: "19:00",
    venueName: "The Great Hall",
    neighbourhoodSlug: "the-great-hall",
    guestCount: 150,
    budget: 900_000n,
  },
] as const;

/**
 * Orders.
 *
 * `totalCents` is the figure the prototype displays; the subtotal and tax are
 * derived from it so the three always sum exactly. Two of the totals divide
 * cleanly by the tax rate (TO-4192 → C$290.00, TO-4191 → C$450.00) and one is
 * tax-free because Kimchi Kart is not HST-registered (TO-4181 → C$1,320.00);
 * the rest do not, so their subtotals carry the rounding. See
 * `docs/design-gaps.md`.
 *
 * Source: adminOrders, lines 2723–2728.
 */
export const ORDERS = [
  {
    reference: "TO-4192",
    userKey: "sarah",
    vendorKey: "bloom",
    eventKey: "sarahs-30th",
    serviceKey: "f1",
    packageName: "Classic",
    quantity: 2,
    /** Line 2723: total C$327.70, deposit C$65.54. */
    totalCents: 32_770n,
    state: "confirmed",
    description: "Classic bouquet × 2 · arrives 4:30 PM",
    /** Deposit paid at the anchor, so the cooling window ends at +48h. */
    depositPaidHoursAfterAnchor: 0,
  },
  {
    reference: "TO-4191",
    userKey: "sarah",
    vendorKey: "lens",
    eventKey: "sarahs-30th",
    serviceKey: "p1",
    packageName: "Standard",
    quantity: 1,
    /** Line 2724: total C$508.50, deposit C$101.70. */
    totalCents: 50_850n,
    state: "confirmed",
    description: "2h event coverage · 5:00–7:00 PM",
    /**
     * Far enough back that the cooling window has already closed, so its
     * deposit share is a settled transfer rather than a second job due at +48h.
     * The prototype's second clock state has exactly one job due (line 2156).
     */
    depositPaidHoursAfterAnchor: -72,
  },
  {
    reference: "TO-4188",
    userKey: "ada",
    vendorKey: "bloom",
    eventKey: "okafor-wedding",
    serviceKey: "f1",
    packageName: "Signature",
    quantity: 6,
    /** Line 2725: total C$1,480.00, paid in full, fulfilled. */
    totalCents: 148_000n,
    state: "fulfilled",
    description: "Signature arrangements × 6",
    depositPaidHoursAfterAnchor: -720,
    paidInFull: true,
  },
  {
    reference: "TO-4181",
    userKey: "sarah",
    vendorKey: "kimchi",
    eventKey: "office-social",
    serviceKey: "c2",
    packageName: null,
    quantity: 60,
    /**
     * Line 2726: total C$1,320.00, balance failed, action required.
     * Kimchi Kart is not HST-registered, so this total carries no tax — the
     * case the money split has to reconcile differently.
     */
    totalCents: 132_000n,
    state: "action_required",
    description: "Korean street food cart · 60 guests",
    depositPaidHoursAfterAnchor: -1440,
    balanceFailed: true,
  },
  {
    reference: "TO-4171",
    userKey: "sarah",
    vendorKey: "sugarhouse",
    eventKey: "baby-shower",
    serviceKey: "k1",
    packageName: "Three tier",
    quantity: 1,
    /** Line 2727: total C$203.40, refunded, cancelled. */
    totalCents: 20_340n,
    state: "cancelled",
    description: "Three-tier celebration cake",
    depositPaidHoursAfterAnchor: -2160,
    refunded: true,
  },
  {
    reference: "TO-4165",
    userKey: "ada",
    vendorKey: "halo",
    eventKey: "corporate-launch",
    serviceKey: "d1",
    packageName: "Standard install",
    quantity: 1,
    /** Line 2728: total C$540.00, paid in full, completed. */
    totalCents: 54_000n,
    state: "completed",
    description: "Balloon and floral install",
    depositPaidHoursAfterAnchor: -2880,
    paidInFull: true,
  },
  {
    reference: "TO-4207",
    userKey: "ada",
    vendorKey: "maple",
    eventKey: "okafor-anniversary",
    serviceKey: "c1",
    packageName: null,
    quantity: 120,
    /**
     * Not in the admin list — it appears only in clock state 3, as
     * "Charge balance · TO-4207 · C$1,480.00" (line 2157). A balance of
     * C$1,480.00 at the 20% deposit rate implies a total of C$1,850.00, which
     * is also the best catering quote the event hub shows (line 2398).
     *
     * Without this row the ops screen shows a job for an order that does not
     * exist.
     */
    totalCents: 185_000n,
    state: "balance_due",
    description: "Canapé catering · 120 guests",
    depositPaidHoursAfterAnchor: -480,
  },
] as const;

/**
 * The open catering quote request.
 *
 * Source: the event hub, line 2398 — "3 quotes in · best C$1,850 · closes
 * Mar 13" — and clock state 0, line 2155: "Expire quote request · catering ·
 * Mar 13, 2027". Mar 13 is seven days before the event, which is how the
 * expiry offset below is derived rather than pinned to a date.
 */
export const QUOTE_REQUEST = {
  key: "catering-sarahs-30th",
  userKey: "sarah",
  eventKey: "sarahs-30th",
  categorySlug: "catering",
  brief: "Canapés, passed, staffed, vegetarian options. 60 guests.",
  answers: { style: "Canapés, passed", service: "Staffed", diet: "Vegetarian options" },
  guestCount: 60,
  budget: 400_000n,
  /** Closes a week before the event. */
  expiresDaysBeforeEvent: 7,
  invitedVendorKeys: ["maple", "kimchi", "quartet"],
  offers: [
    { vendorKey: "maple", subtotalCents: 185_000n, message: "Passed canapés, two staff." },
    { vendorKey: "kimchi", subtotalCents: 132_000n, message: "Cart service, 60 guests." },
  ],
} as const;
