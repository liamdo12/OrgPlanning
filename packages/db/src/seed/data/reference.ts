/**
 * Reference data, transcribed from the prototype.
 *
 * Citations are line numbers in `design/Event Marketplace Glass.dc.html`.
 */

/**
 * Source: `cats()`, lines 1968–1973. `all` is a UI filter, not a category.
 *
 * The tone is the category's whole visual in the prototype — it draws a
 * gradient tile and no icon — so it is transcribed exactly rather than
 * approximated with a colour of our own.
 */
export const CATEGORIES = [
  {
    slug: "flowers",
    name: "Flowers",
    displayCount: 21,
    tone: "linear-gradient(140deg, #EADFD1, #D6BFA8)",
  },
  {
    slug: "catering",
    name: "Catering",
    displayCount: 34,
    tone: "linear-gradient(140deg, #E7DDCB, #CDB79A)",
  },
  {
    slug: "cakes",
    name: "Cakes",
    displayCount: 17,
    tone: "linear-gradient(140deg, #EFE2DA, #DCC3B6)",
  },
  {
    slug: "photography",
    name: "Photography",
    displayCount: 26,
    tone: "linear-gradient(140deg, #D9E2DB, #B4C6BA)",
  },
  {
    slug: "entertainment",
    name: "Entertainment",
    displayCount: 15,
    tone: "linear-gradient(140deg, #DCD9E6, #BDB8CF)",
  },
  {
    slug: "decorations",
    name: "Decorations",
    displayCount: 11,
    tone: "linear-gradient(140deg, #E9DCDF, #D0B4BA)",
  },
] as const;

/**
 * Source: places(), lines 1915–1932 — 18 entries.
 *
 * Coordinates are approximate centroids for each place, used for distance
 * sorting later; the prototype carries no coordinates of its own.
 */
export const PLACES = [
  {
    slug: "liberty-village",
    name: "Liberty Village",
    kind: "neighbourhood",
    subtitle: "Neighbourhood · Toronto, ON · M6K",
    postalPrefix: "M6K",
    searchTags: "liberty village m6k west",
    latitude: "43.637800",
    longitude: "-79.420100",
  },
  {
    slug: "downtown-core",
    name: "Downtown core",
    kind: "neighbourhood",
    subtitle: "Neighbourhood · Toronto, ON · M5H",
    postalPrefix: "M5H",
    searchTags: "downtown core financial district m5h",
    latitude: "43.648500",
    longitude: "-79.382000",
  },
  {
    slug: "distillery-district",
    name: "Distillery District",
    kind: "neighbourhood",
    subtitle: "Neighbourhood · Toronto, ON · M5A",
    postalPrefix: "M5A",
    searchTags: "distillery district old town m5a",
    latitude: "43.650300",
    longitude: "-79.359400",
  },
  {
    slug: "queen-west",
    name: "Queen West",
    kind: "neighbourhood",
    subtitle: "Neighbourhood · Toronto, ON · M6J",
    postalPrefix: "M6J",
    searchTags: "queen west trinity bellwoods m6j",
    latitude: "43.647000",
    longitude: "-79.410000",
  },
  {
    slug: "roncesvalles",
    name: "Roncesvalles",
    kind: "neighbourhood",
    subtitle: "Neighbourhood · Toronto, ON · M6R",
    postalPrefix: "M6R",
    searchTags: "roncesvalles ronces west m6r",
    latitude: "43.650800",
    longitude: "-79.449800",
  },
  {
    slug: "the-annex",
    name: "The Annex",
    kind: "neighbourhood",
    subtitle: "Neighbourhood · Toronto, ON · M5R",
    postalPrefix: "M5R",
    searchTags: "annex bloor dupont m5r",
    latitude: "43.670300",
    longitude: "-79.407000",
  },
  {
    slug: "yorkville",
    name: "Yorkville",
    kind: "neighbourhood",
    subtitle: "Neighbourhood · Toronto, ON · M5R",
    postalPrefix: "M5R",
    searchTags: "yorkville bloor midtown m5r",
    latitude: "43.671200",
    longitude: "-79.393200",
  },
  {
    slug: "leslieville",
    name: "Leslieville",
    kind: "neighbourhood",
    subtitle: "Neighbourhood · Toronto, ON · M4M",
    postalPrefix: "M4M",
    searchTags: "leslieville east end m4m",
    latitude: "43.662800",
    longitude: "-79.334200",
  },
  {
    slug: "the-beaches",
    name: "The Beaches",
    kind: "neighbourhood",
    subtitle: "Neighbourhood · Toronto, ON · M4E",
    postalPrefix: "M4E",
    searchTags: "beaches beach east m4e",
    latitude: "43.671300",
    longitude: "-79.297100",
  },
  {
    slug: "midtown",
    name: "Midtown",
    kind: "neighbourhood",
    subtitle: "Neighbourhood · Toronto, ON · M4S",
    postalPrefix: "M4S",
    searchTags: "midtown yonge eglinton m4s",
    latitude: "43.706700",
    longitude: "-79.398600",
  },
  {
    slug: "north-york",
    name: "North York",
    kind: "district",
    subtitle: "District · Toronto, ON · M2N",
    postalPrefix: "M2N",
    searchTags: "north york sheppard m2n",
    latitude: "43.768000",
    longitude: "-79.412800",
  },
  {
    slug: "etobicoke",
    name: "Etobicoke",
    kind: "district",
    subtitle: "District · Toronto, ON · M8V",
    postalPrefix: "M8V",
    searchTags: "etobicoke mimico lakeshore m8v",
    latitude: "43.613400",
    longitude: "-79.511200",
  },
  {
    slug: "scarborough",
    name: "Scarborough",
    kind: "district",
    subtitle: "District · Toronto, ON · M1P",
    postalPrefix: "M1P",
    searchTags: "scarborough east m1p",
    latitude: "43.773400",
    longitude: "-79.257700",
  },
  {
    slug: "evergreen-brick-works",
    name: "Evergreen Brick Works",
    kind: "venue",
    subtitle: "Venue · 550 Bayview Ave · M4W",
    postalPrefix: "M4W",
    searchTags: "evergreen brick works venue bayview m4w",
    latitude: "43.684600",
    longitude: "-79.365700",
  },
  {
    slug: "casa-loma",
    name: "Casa Loma",
    kind: "venue",
    subtitle: "Venue · 1 Austin Terrace · M5R",
    postalPrefix: "M5R",
    searchTags: "casa loma venue castle austin m5r",
    latitude: "43.678000",
    longitude: "-79.409400",
  },
  {
    slug: "the-great-hall",
    name: "The Great Hall",
    kind: "venue",
    subtitle: "Venue · 1087 Queen St W · M6J",
    postalPrefix: "M6J",
    searchTags: "great hall venue queen west m6j",
    latitude: "43.643400",
    longitude: "-79.419000",
  },
  {
    slug: "steam-whistle-brewing",
    name: "Steam Whistle Brewing",
    kind: "venue",
    subtitle: "Venue · 255 Bremner Blvd · M5V",
    postalPrefix: "M5V",
    searchTags: "steam whistle brewing venue roundhouse m5v",
    latitude: "43.641600",
    longitude: "-79.384500",
  },
  {
    slug: "all-of-toronto",
    name: "All of Toronto",
    kind: "city",
    subtitle: "Anywhere in the city",
    postalPrefix: null,
    searchTags: "all toronto anywhere city everywhere",
    latitude: "43.653200",
    longitude: "-79.383200",
  },
] as const;

/**
 * Cancellation policies.
 *
 * `moderate` is the seeded default (line 1889) and its 48-hour free window is
 * what the prototype's confirmation promises — "you can cancel free of charge
 * until Sep 17, 2026" for a deposit paid Sep 15 (line 1191). That same 48 hours
 * is the cooling window before the deposit share transfers to the vendor.
 */
export const POLICY_TEMPLATES = [
  {
    tier: "flexible",
    name: "Flexible",
    summary: "Free cancellation up to 7 days before the event; full refund.",
    depositBps: 1_000,
    freeCancellationHours: 168,
    lateRefundBps: 10_000,
  },
  {
    tier: "moderate",
    name: "Moderate",
    summary: "Free cancellation within 48 hours of booking; 50% after that.",
    depositBps: 2_000,
    freeCancellationHours: 48,
    lateRefundBps: 5_000,
  },
  {
    tier: "strict",
    name: "Strict",
    summary: "Deposit is non-refundable once the booking is confirmed.",
    depositBps: 3_000,
    freeCancellationHours: 0,
    lateRefundBps: 0,
  },
] as const;

/** Source: HST 13% (line 1173); deposit 20% (lines 1177–1178, 65.54 of 327.70). */
export const PLATFORM_SETTINGS = [
  {
    key: "commission_bps",
    value: 1000,
    description: "Platform commission, in basis points of the pre-tax subtotal.",
  },
  { key: "hst_bps", value: 1300, description: "Ontario HST, in basis points." },
  {
    key: "deposit_bps",
    value: 2000,
    description: "Deposit taken at checkout, in basis points of the total.",
  },
  {
    key: "cooling_window_hours",
    value: 48,
    description: "Hours after the deposit before the vendor share transfers.",
  },
  {
    key: "balance_lead_days",
    value: 14,
    description: "Days before the event that the balance is charged off-session.",
  },
  {
    key: "auto_complete_hours",
    value: 72,
    description: "Hours after the event before an untouched order completes.",
  },
  {
    key: "balance_grace_hours",
    value: 72,
    description: "Hours a customer has to rescue a declined balance.",
  },
  { key: "currency", value: "CAD", description: "Only supported currency." },
] as const;
