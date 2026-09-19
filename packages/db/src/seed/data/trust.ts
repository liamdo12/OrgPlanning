/**
 * Reviews, complaints and reported content.
 *
 * The prototype draws none of these screens, so nothing here cites a line: it
 * is demo material for the four capabilities the business proposal names and
 * the design import never covered. What it does follow are the seed's own two
 * rules — deterministic ids and offsets from the anchor, never literal dates.
 *
 * The cases hang off orders that already exist. A dispute is deliberately not
 * an order state: an order can be delivered and complained about at the same
 * time, which is exactly what `TO-4188` below is.
 */

export const REVIEWS = [
  {
    key: "halo-4165",
    /** The one completed order: a review is unlocked by completion. */
    orderReference: "TO-4165",
    rating: 5,
    body: "Studio Halo turned the room around in an afternoon. The arch was the photo everybody took.",
    publishedDaysAfterAnchor: -55,
  },
] as const;

export const DISPUTES = [
  {
    key: "late-delivery",
    orderReference: "TO-4188",
    /** The customer on the order; the seed resolves the id from the order. */
    raisedBy: "customer",
    state: "open",
    reason: "Delivered late",
    detail:
      "The arrangements arrived a little after four, and the toast was at half past three. Asking what can be done.",
    openedDaysAfterAnchor: -4,
    messages: [],
  },
  {
    key: "balance-dispute",
    orderReference: "TO-4181",
    raisedBy: "customer",
    state: "under_review",
    reason: "Charged after cancelling",
    detail:
      "Says the cart was cancelled by phone on the day of booking, and the balance has been attempted since.",
    openedDaysAfterAnchor: -2,
    /** Assigned to the administrator, because somebody is looking at it. */
    assignTo: "admin",
    messages: [
      {
        key: "note-1",
        authorKey: "admin",
        body: "No cancellation on file and the vendor has no record of the call. Asked for the number it was made from.",
        daysAfterAnchor: -1,
      },
    ],
  },
] as const;

export const CONTENT_REPORTS = [
  {
    key: "review-4165",
    targetType: "review",
    /** Resolved to the review seeded above. */
    targetKey: "halo-4165",
    reporterKey: "rosa",
    reason: "Names a member of staff",
    detail: "The review used to name the florist personally; asking for it to be looked at.",
    daysAfterAnchor: -6,
  },
  {
    key: "terrace-profile",
    targetType: "vendor_profile",
    targetKey: "terrace",
    reporterKey: "ada",
    reason: "Misleading claim",
    detail: "The tagline claims a licence the business does not appear to hold.",
    daysAfterAnchor: -9,
  },
] as const;
