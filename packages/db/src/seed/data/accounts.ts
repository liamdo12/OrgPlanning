/**
 * People and businesses, transcribed from the prototype.
 *
 * Citations are line numbers in `design/Event Marketplace Glass.dc.html`.
 */

/**
 * Source: adminUsers, lines 2629–2634 — six accounts across four statuses.
 *
 * The four statuses matter: an admin screen that only knows "active" and
 * "suspended" cannot show Dae Kim awaiting approval or Jonah Tran who never
 * confirmed an email address.
 */
export const USERS = [
  {
    key: "sarah",
    fullName: "Sarah Mensah",
    email: "sarah@example.ca",
    status: "active",
    roles: ["customer"],
    activity: "3 events · 5 orders · C$1,039",
    emailVerified: true,
  },
  {
    key: "ada",
    fullName: "Ada Okafor",
    email: "ada.okafor@example.ca",
    status: "active",
    roles: ["customer"],
    activity: "1 event · 11 orders · C$8,410",
    emailVerified: true,
  },
  {
    key: "rosa",
    fullName: "Rosa Lam",
    email: "rosa@bloomandco.ca",
    status: "active",
    roles: ["vendor"],
    activity: "Bloom & Co · owner · payouts enabled",
    emailVerified: true,
  },
  {
    key: "dae",
    fullName: "Dae Kim",
    email: "dae@kimchikart.ca",
    status: "pending",
    roles: ["vendor"],
    activity: "Kimchi Kart · owner · onboarding 80%",
    emailVerified: true,
  },
  {
    key: "jonah",
    fullName: "Jonah Tran",
    email: "jonah.tran@example.ca",
    status: "unverified",
    roles: ["customer"],
    activity: "0 orders · 2 quote requests",
    emailVerified: false,
  },
  {
    key: "bea",
    fullName: "Bea Varga",
    email: "bea@terracerentals.ca",
    status: "suspended",
    roles: ["vendor"],
    activity: "Terrace Rentals · flagged for 2 chargebacks",
    emailVerified: true,
  },
] as const;

/** The operator account. Not in the prototype; every admin screen needs one. */
export const ADMIN_USER = {
  key: "admin",
  fullName: "Occasion Admin",
  email: "admin@occasion.test",
  status: "active",
  roles: ["admin"],
} as const;

/**
 * Source: adminVendors, lines 2715–2720 — six vendors, two of them Pending.
 *
 * `Terrace Rentals` is Blocked with incomplete onboarding, which is why it has
 * no connected payment account.
 *
 * The taglines are not from the prototype, which shows a business by its
 * category and neighbourhood rather than by a line it wrote. They are here
 * because the moderation queue takes reports about a vendor's own profile text,
 * and a queue whose demo rows point at an empty column demonstrates nothing.
 * Terrace Rentals' is the one the seeded report is about.
 */
export const ADMIN_VENDORS = [
  {
    key: "bloom",
    tagline: "Seasonal arrangements, grown and tied in Liberty Village.",
    slug: "bloom-and-co",
    name: "Bloom & Co",
    categorySlug: "flowers",
    baseArea: "Liberty Village",
    status: "approved",
    stripeConnected: true,
    hstRegistered: true,
    ownerKey: "rosa",
    detail: "Flowers · Liberty Village · Stripe test connected",
  },
  {
    key: "kimchi",
    tagline: "Korean street food, served hot from the cart.",
    slug: "kimchi-kart",
    name: "Kimchi Kart",
    categorySlug: "catering",
    baseArea: "North York",
    status: "pending",
    stripeConnected: true,
    // Below the registration threshold: this vendor charges no HST, which is
    // the case the money split has to reconcile differently.
    hstRegistered: false,
    ownerKey: "dae",
    onboardingPercent: "80",
    detail: "Catering · North York · Stripe test connected",
  },
  {
    key: "lens",
    tagline: "Documentary event photography, two shooters, fast turnaround.",
    slug: "lens-studio",
    name: "Lens Studio",
    categorySlug: "photography",
    baseArea: "Downtown",
    status: "approved",
    stripeConnected: true,
    hstRegistered: true,
    ownerKey: null,
    detail: "Photography · Downtown · Stripe test connected",
  },
  {
    key: "terrace",
    tagline: "Fully licensed and insured for every venue in the city.",
    slug: "terrace-rentals",
    name: "Terrace Rentals",
    categorySlug: "decorations",
    baseArea: "Etobicoke",
    status: "blocked",
    stripeConnected: false,
    hstRegistered: true,
    ownerKey: "bea",
    detail: "Decorations · Etobicoke · onboarding incomplete",
  },
  {
    key: "quartet",
    tagline: "Strings for ceremonies, receptions and everything between.",
    slug: "the-bloor-quartet",
    name: "The Bloor Quartet",
    categorySlug: "entertainment",
    baseArea: "Midtown",
    status: "pending",
    stripeConnected: true,
    hstRegistered: true,
    ownerKey: null,
    detail: "Entertainment · Midtown · Stripe test connected",
  },
  {
    key: "halo",
    tagline: "Arches, backdrops and lighting, installed and struck same day.",
    slug: "studio-halo",
    name: "Studio Halo",
    categorySlug: "decorations",
    baseArea: "West End",
    status: "approved",
    stripeConnected: true,
    hstRegistered: true,
    ownerKey: null,
    detail: "Decorations · West End · Stripe test connected",
  },
] as const;

/**
 * Vendors that appear only in the catalogue, never in the admin queue.
 *
 * Source: the services list, lines 1950–1961. They exist so discovery has
 * something to show; the admin approval queue must stay at six rows.
 */
export const CATALOG_VENDORS = [
  {
    key: "maple",
    slug: "maple-and-thyme",
    name: "Maple & Thyme",
    categorySlug: "catering",
    baseArea: "Downtown",
    status: "approved",
    hstRegistered: true,
  },
  {
    key: "sugarhouse",
    slug: "sugarhouse",
    name: "Sugarhouse",
    categorySlug: "cakes",
    baseArea: "Leslieville",
    status: "approved",
    hstRegistered: true,
  },
  {
    key: "northside",
    slug: "northside-djs",
    name: "Northside DJs",
    categorySlug: "entertainment",
    baseArea: "Downtown",
    status: "approved",
    hstRegistered: true,
  },
  {
    key: "goldhouse",
    slug: "goldhouse-photo",
    name: "Goldhouse Photo",
    categorySlug: "photography",
    baseArea: "East End",
    status: "approved",
    hstRegistered: true,
  },
  {
    key: "wildwood",
    slug: "wildwood-florals",
    name: "Wildwood Florals",
    categorySlug: "flowers",
    baseArea: "Downtown",
    status: "approved",
    hstRegistered: true,
  },
  {
    key: "ruby",
    slug: "ruby-patisserie",
    name: "Ruby Patisserie",
    categorySlug: "cakes",
    baseArea: "Midtown",
    status: "approved",
    hstRegistered: true,
  },
] as const;
