/**
 * The catalogue, transcribed from the prototype's services list
 * (`design/Event Marketplace Glass.dc.html`, lines 1950–1961).
 *
 * Twelve services, two per category. The plan estimated "~30"; the prototype
 * defines twelve, and inventing eighteen more would put fabricated rows behind
 * screens whose whole purpose is to match it. Recorded in
 * `docs/design-gaps.md`.
 *
 * Prices are in cents.
 *
 * `policyTier` names the cancellation policy each service is sold under, which
 * is what the deposit and the free-cancellation window are read from at
 * checkout. Three tiers appear, so the demo shows a policy that varies by
 * listing rather than one constant nobody chose — but every service a seeded
 * order was written against stays `moderate`, because those orders record
 * `policy:moderate` and their money is derived at that deposit rate. Moving one
 * of them would leave an order whose terms disagree with its own deposit.
 */

export const SERVICES = [
  {
    key: "f1",
    vendorKey: "bloom",
    categorySlug: "flowers",
    slug: "bridal-and-table-bouquets",
    title: "Bridal & table bouquets",
    basePrice: 9_500n,
    priceUnit: "bouquet",
    bookingMode: "book_now",
    policyTier: "moderate",
    published: true,
    badge: "Popular",
    areaLabel: "Serves Downtown & West End",
    rating: "4.9",
    reviews: 86,
    tone: ["#EADFD1", "#D6BFA8"],
    areas: ["downtown-core", "queen-west", "liberty-village", "roncesvalles"],
    /**
     * The tier the seeded order buys. Source: the checkout line,
     * line 1149 — "Classic bouquet × 2 · C$290.00", so C$145.00 each.
     */
    packages: [
      { name: "Classic", unitPrice: 14_500n, description: "Seasonal stems, vase included." },
      { name: "Signature", unitPrice: 22_000n, description: "Larger arrangement, premium stems." },
    ],
  },
  {
    key: "p1",
    vendorKey: "lens",
    categorySlug: "photography",
    slug: "2h-event-coverage",
    title: "2h event coverage",
    basePrice: 45_000n,
    priceUnit: "event",
    bookingMode: "book_now",
    policyTier: "moderate",
    published: true,
    badge: "Book now",
    areaLabel: "Serves all of Toronto",
    rating: "4.8",
    reviews: 41,
    tone: ["#D9E2DB", "#B4C6BA"],
    areas: ["all-of-toronto"],
    packages: [{ name: "Standard", unitPrice: 45_000n, description: "Two hours, edited gallery." }],
  },
  {
    key: "c1",
    vendorKey: "maple",
    categorySlug: "catering",
    slug: "canape-catering",
    title: "Canapé catering, 40–120 guests",
    basePrice: 3_800n,
    priceUnit: "guest",
    bookingMode: "quote",
    policyTier: "moderate",
    published: true,
    badge: "Quotes",
    areaLabel: "Serves Downtown & Midtown",
    rating: "4.8",
    reviews: 132,
    tone: ["#E7DDCB", "#CDB79A"],
    areas: ["downtown-core", "midtown"],
    packages: [],
  },
  {
    key: "k1",
    vendorKey: "sugarhouse",
    categorySlug: "cakes",
    slug: "three-tier-celebration-cake",
    title: "Three-tier celebration cake",
    basePrice: 18_000n,
    priceUnit: "cake",
    bookingMode: "book_now",
    policyTier: "moderate",
    published: true,
    badge: "Pickup",
    areaLabel: "Pickup in Leslieville · 4.1 km",
    rating: "4.9",
    reviews: 57,
    tone: ["#EFE2DA", "#DCC3B6"],
    areas: ["leslieville"],
    packages: [{ name: "Three tier", unitPrice: 18_000n, description: "Serves 60." }],
  },
  {
    key: "e1",
    vendorKey: "northside",
    categorySlug: "entertainment",
    slug: "dj-and-lighting",
    title: "DJ and lighting, 4 hours",
    basePrice: 62_000n,
    priceUnit: "event",
    bookingMode: "quote",
    policyTier: "flexible",
    published: true,
    badge: "Quotes",
    areaLabel: "Serves all of Toronto",
    rating: "4.7",
    reviews: 74,
    tone: ["#DCD9E6", "#BDB8CF"],
    areas: ["all-of-toronto"],
    packages: [],
  },
  {
    key: "d1",
    vendorKey: "halo",
    categorySlug: "decorations",
    slug: "balloon-and-floral-installs",
    title: "Balloon and floral installs",
    basePrice: 34_000n,
    priceUnit: "install",
    bookingMode: "quote",
    policyTier: "moderate",
    published: true,
    badge: "Quotes",
    areaLabel: "Serves West End",
    rating: "4.9",
    reviews: 38,
    tone: ["#E9DCDF", "#D0B4BA"],
    areas: ["queen-west", "roncesvalles", "liberty-village"],
    packages: [{ name: "Standard install", unitPrice: 34_000n, description: "Arch and backdrop." }],
  },
  {
    key: "p2",
    vendorKey: "goldhouse",
    categorySlug: "photography",
    slug: "photo-booth-3h",
    title: "Photo booth, 3 hours",
    basePrice: 39_000n,
    priceUnit: "event",
    bookingMode: "book_now",
    policyTier: "flexible",
    /**
     * The one draft, and the only reason it is one.
     *
     * Publication and vendor standing are two separate conditions on every
     * discovery query, and with every service published the first would be
     * satisfied by every row — so a test asserting an unpublished service is
     * absent would be asserting nothing. Gold House is approved and carries no
     * seeded order and no quote request, so leaving this listing a draft
     * exercises publication on its own and takes no demo screen with it: the
     * photography category still shows Lens Studio's coverage.
     */
    published: false,
    badge: "Book now",
    areaLabel: "Serves Downtown & East End",
    rating: "4.6",
    reviews: 22,
    tone: ["#E4E0D3", "#C8C1AB"],
    areas: ["downtown-core", "leslieville", "the-beaches"],
    packages: [{ name: "Three hours", unitPrice: 39_000n, description: "Attendant and prints." }],
  },
  {
    key: "c2",
    vendorKey: "kimchi",
    categorySlug: "catering",
    slug: "korean-street-food-cart",
    title: "Korean street food cart",
    basePrice: 2_200n,
    priceUnit: "guest",
    bookingMode: "quote",
    policyTier: "moderate",
    published: true,
    badge: "New",
    areaLabel: "Serves North York & Midtown",
    rating: "4.9",
    reviews: 61,
    tone: ["#EADBD3", "#D3B0A2"],
    areas: ["north-york", "midtown"],
    packages: [],
  },
  {
    key: "f2",
    vendorKey: "wildwood",
    categorySlug: "flowers",
    slug: "ceremony-arch-florals",
    title: "Ceremony arch florals",
    basePrice: 52_000n,
    priceUnit: "arch",
    bookingMode: "quote",
    policyTier: "strict",
    published: true,
    badge: "Quotes",
    areaLabel: "Serves all of Toronto",
    rating: "4.7",
    reviews: 29,
    tone: ["#DEE5D7", "#BCCAB0"],
    areas: ["all-of-toronto"],
    packages: [],
  },
  {
    key: "k2",
    vendorKey: "ruby",
    categorySlug: "cakes",
    slug: "dessert-table-60",
    title: "Dessert table, 60 servings",
    basePrice: 26_000n,
    priceUnit: "table",
    bookingMode: "book_now",
    policyTier: "flexible",
    published: true,
    badge: "Book now",
    areaLabel: "Delivery across Toronto",
    rating: "4.8",
    reviews: 44,
    tone: ["#F0E0DE", "#DBB6B4"],
    areas: ["all-of-toronto"],
    packages: [{ name: "Sixty servings", unitPrice: 26_000n, description: "Assorted pastries." }],
  },
  {
    key: "e2",
    vendorKey: "quartet",
    categorySlug: "entertainment",
    slug: "string-quartet-two-sets",
    title: "String quartet, two sets",
    basePrice: 90_000n,
    priceUnit: "event",
    bookingMode: "quote",
    policyTier: "strict",
    published: true,
    badge: "Top rated",
    areaLabel: "Serves all of Toronto",
    rating: "5.0",
    reviews: 18,
    tone: ["#DBDDE4", "#B6BAC8"],
    areas: ["all-of-toronto"],
    packages: [],
  },
  {
    key: "d2",
    vendorKey: "terrace",
    categorySlug: "decorations",
    slug: "lounge-furniture-package",
    title: "Lounge furniture package",
    basePrice: 48_000n,
    priceUnit: "package",
    bookingMode: "book_now",
    policyTier: "moderate",
    published: true,
    badge: "Book now",
    areaLabel: "Delivery across Toronto",
    rating: "4.5",
    reviews: 31,
    tone: ["#E6E2D8", "#C9C2B1"],
    areas: ["all-of-toronto"],
    packages: [{ name: "Lounge set", unitPrice: 48_000n, description: "Seating for 20." }],
  },
] as const;

/**
 * How many pictures each listing carries.
 *
 * Only listings a customer can actually reach are here: published, and belonging
 * to an approved business. A draft listing and a listing whose vendor is pending
 * or blocked are refused by discovery and by the detail page alike, so pictures
 * on them would be rows no screen ever reads.
 *
 * Three shapes on purpose, because the components degrade in three different
 * ways and a seed that gave every listing the same count would exercise one of
 * them:
 *
 *   `f1` has **none** — the card draws a single gradient frame and no dots, and
 *   the detail strip draws four gradients and no gallery control. That is the
 *   honest empty state, and it is also the shape the discovery suite asserts
 *   against: one test needs a listable card with no pictures, and another owns
 *   this listing's media outright by inserting its own.
 *
 *   `k2` has **one** — a frame with no dots, which is not the same code path as
 *   none and is where an off-by-one in the pager shows.
 *
 *   `d1` has **six** — more than the strip's four cells, so the last cell reads
 *   "+2 photos" rather than the count it refuses to invent, and the card's
 *   three-picture cap is cut in SQL over a listing that has more than three.
 *
 * The rest carry three: three dots on the card, a hero and two thumbnails on the
 * detail page.
 *
 * `captions` is written on the one gallery big enough to be browsed, so the
 * supplied-alt branch is exercised by real rows; everywhere else `alt_text` is
 * left null and the components generate their own. Both branches ship, so both
 * need a row behind them.
 */
export const SERVICE_MEDIA = [
  { key: "f1", pictures: 0 },
  { key: "p1", pictures: 3 },
  { key: "c1", pictures: 3 },
  { key: "k1", pictures: 3 },
  { key: "e1", pictures: 3 },
  {
    key: "d1",
    pictures: 6,
    captions: [
      "A balloon arch in blush and cream over a loft doorway.",
      "A floral backdrop behind a cake table.",
      "Ceiling balloons clustered above a dance floor.",
      "A garland of eucalyptus along a banquet table.",
      "A pastel balloon column beside a bar.",
      "The finished install, lit for the evening.",
    ],
  },
  { key: "f2", pictures: 3 },
  { key: "k2", pictures: 1 },
] as const;

/**
 * Days a business will not take work.
 *
 * The availability line has three answers and until these rows existed it could
 * only ever give two: free always, booked from the seeded capacity blocks, and
 * closed never. A blackout is only visible on a day one of the customer's own
 * events falls on, because that is the date the service page asks about — so
 * each one names the event whose date it borrows rather than a date of its own,
 * and the writer reads that date back off the `events` row.
 *
 * Both businesses are approved and both list something published, which is what
 * the availability read requires before it will answer about a service at all.
 * Studio Halo is deliberately not here: it is the vendor behind the one slot
 * the planner shows in plan, and a business closed on the day of the event
 * somebody is planning to buy from it is a contradiction the checkout would not
 * refuse.
 */
export const BLACKOUTS = [
  { vendorKey: "wildwood", eventKey: "sarahs-30th", reason: "Closed — studio inventory" },
  { vendorKey: "northside", eventKey: "office-social", reason: "Closed — crew at a wedding" },
] as const;

/**
 * The listings a customer has shortlisted. Source: the prototype's own saved
 * set, line 1882 — the bouquets and the coverage, both hearted.
 *
 * `savedDaysBeforeAnchor` is written rather than left to the column default.
 * Every row in one seed lands in a single transaction, so defaulted timestamps
 * are all equal and "newest first" degenerates into the tiebreak on the
 * service's id — an ordering no test could assert and no screen could be shown
 * to have got right.
 */
export const SHORTLIST = [
  { userKey: "sarah", serviceKey: "f1", savedDaysBeforeAnchor: 9 },
  { userKey: "sarah", serviceKey: "p1", savedDaysBeforeAnchor: 2 },
] as const;
