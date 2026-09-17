/**
 * The three role themes.
 *
 * Source: the prototype's `TH` map, lines 1993–1997. A theme is three
 * variables — primary, hover, tint — and the CSS holds their values; this file
 * exists so callers have a type rather than a string.
 *
 * Deliberately not imported from `@occasion/core`: this package renders and
 * knows nothing about authorization. The names happen to match the domain's
 * roles, and that is all.
 */
export const ROLES = ["customer", "vendor", "admin"] as const;

export type Role = (typeof ROLES)[number];
