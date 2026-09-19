import { ValidationError } from "../errors.js";

/**
 * The platform's own numbers, and where each of them is actually read.
 *
 * A settings screen is only worth having if changing a value changes what the
 * platform does. Two of these are read at boot and one is fixed by the
 * lifecycle specification, and saying so beside each one is the difference
 * between a settings page and a form that writes to a table nobody consults.
 *
 * `editable: false` is not a placeholder. It means the value is genuinely
 * decided somewhere else, named in `source`, and the screen shows it as a fact
 * rather than offering a field that would do nothing.
 */

export const SETTING_KEYS = [
  "commission_bps",
  "hst_bps",
  "deposit_bps",
  "cooling_window_hours",
  "balance_lead_days",
  "auto_complete_hours",
  "balance_grace_hours",
  "currency",
] as const;

export type SettingKey = (typeof SETTING_KEYS)[number];

export type SettingKind = "bps" | "hours" | "days" | "text";

export type SettingSpec = {
  key: SettingKey;
  label: string;
  kind: SettingKind;
  editable: boolean;
  /** Inclusive bounds for a numeric setting. */
  min?: number;
  max?: number;
  /** What it means. */
  description: string;
  /** Where the value takes effect, or where it really comes from. */
  source: string;
};

export const SETTING_SPECS: readonly SettingSpec[] = [
  {
    key: "commission_bps",
    label: "Commission",
    kind: "bps",
    editable: true,
    min: 0,
    // Above about 90% the platform's cut exceeds what the customer paid and
    // `computeOrderMoney` refuses the order outright. Half is already far past
    // anything defensible, and a rate that cannot be typed is a rate that
    // cannot be typed by accident.
    max: 5_000,
    description: "Charged on the pre-tax subtotal of every order.",
    source: "Read when a checkout is priced.",
  },
  {
    key: "hst_bps",
    label: "HST",
    kind: "bps",
    editable: true,
    min: 0,
    max: 3_000,
    description:
      "Ontario sales tax. Follows the vendor as supplier, so an HST-registered vendor's tax reaches them.",
    source: "Read when a checkout is priced.",
  },
  {
    key: "deposit_bps",
    label: "Default deposit",
    kind: "bps",
    editable: true,
    min: 0,
    max: 10_000,
    description:
      "Taken at checkout when the booking carries no cancellation policy of its own. A policy template's own rate wins.",
    source: "Read when a checkout is priced.",
  },
  {
    key: "cooling_window_hours",
    label: "Free-cancellation window",
    kind: "hours",
    editable: true,
    min: 0,
    max: 30 * 24,
    description:
      "How long after the deposit a customer may cancel for a full refund, and therefore how long the vendor's share is held.",
    source: "Read when a checkout is priced.",
  },
  {
    key: "balance_lead_days",
    label: "Balance charged before the event",
    kind: "days",
    editable: true,
    min: 0,
    max: 365,
    description:
      "How far ahead of the event the remaining balance is charged off-session. Below this, a booking is paid in full at checkout.",
    source: "Read when a checkout is priced.",
  },
  {
    key: "auto_complete_hours",
    label: "Auto-complete after the event",
    kind: "hours",
    editable: false,
    description: "How long after an event an untouched order completes itself.",
    source:
      "Fixed by the order lifecycle (ordering/transitions.ts), which is the specification every phase cites. Changing it is a code change with a test.",
  },
  {
    key: "balance_grace_hours",
    label: "Grace after a declined balance",
    kind: "hours",
    editable: false,
    description: "How long a customer has to rescue a balance the card declined.",
    source:
      "Fixed by the order lifecycle (ordering/transitions.ts), which is the specification every phase cites. Changing it is a code change with a test.",
  },
  {
    key: "currency",
    label: "Currency",
    kind: "text",
    editable: false,
    description: "The only currency the platform prices in.",
    source:
      "Fixed in the core context at boot. A second currency is a schema change, not a setting.",
  },
];

export function specFor(key: string): SettingSpec {
  const spec = SETTING_SPECS.find((entry) => entry.key === key);
  if (!spec) throw new ValidationError(`${key} is not a platform setting.`, { key: "unknown" });
  return spec;
}

/**
 * Turns what a form sent into what the column stores.
 *
 * Refuses an uneditable key here rather than in the caller, so a direct POST
 * meets the same answer the screen gives — the field it would be aiming at is
 * not rendered, which stops nobody.
 */
export function parseSettingValue(key: string, raw: string): number | string {
  const spec = specFor(key);

  if (!spec.editable) {
    throw new ValidationError(`${spec.label} is not set here. ${spec.source}`, {
      key: "not_editable",
    });
  }

  if (spec.kind === "text") {
    const value = raw.trim();
    if (!value) throw new ValidationError(`${spec.label} cannot be empty.`, { value: "required" });
    return value;
  }

  // Integers only. A basis point is already the fractional form of a rate, and
  // a float here is the beginning of an amount that does not reconcile.
  const value = Number(raw.trim());
  if (!Number.isInteger(value)) {
    throw new ValidationError(`${spec.label} must be a whole number.`, { value: "not_integer" });
  }
  if (spec.min !== undefined && value < spec.min) {
    throw new ValidationError(`${spec.label} cannot be below ${spec.min}.`, { value: "too_low" });
  }
  if (spec.max !== undefined && value > spec.max) {
    throw new ValidationError(`${spec.label} cannot be above ${spec.max}.`, { value: "too_high" });
  }

  return value;
}

/** How a stored value reads on the screen. */
export function formatSettingValue(key: SettingKey, value: unknown): string {
  const spec = specFor(key);
  if (typeof value === "string") return value;
  if (typeof value !== "number") {
    // The column is `jsonb`, so a setting can hold a shape. Serialised rather
    // than coerced: `String({})` is `[object Object]`, which reads on screen as
    // a value somebody typed.
    return value === null || value === undefined ? "—" : JSON.stringify(value);
  }

  switch (spec.kind) {
    case "bps":
      // Two decimals then trimmed: 1000 is "10%", 1250 is "12.5%".
      return `${Number((value / 100).toFixed(2))}%`;
    case "hours":
      return value === 1 ? "1 hour" : `${value} hours`;
    case "days":
      return value === 1 ? "1 day" : `${value} days`;
    default:
      return String(value);
  }
}

/**
 * Whether a category's tile colour is something we are willing to render.
 *
 * The value goes straight into a `background`, and a `background` can fetch:
 * `url(https://…)` in one is an outbound request from every render of the
 * screen — from an administrator's browser today and from a public discovery
 * page later. An administrator is trusted, but "trusted" is not the same as
 * "should be able to point every visitor's browser at a third party by typing
 * in a text box".
 *
 * So: a hex colour, or a CSS gradient over hex colours, which is exactly what
 * the prototype's own six are. Anything else is refused with the shape it
 * wanted, rather than silently stripped.
 */
const HEX = String.raw`#[0-9a-fA-F]{3,8}`;
const TONE = new RegExp(`^(?:${HEX}|(?:linear|radial|conic)-gradient\\(\\s*[^()]*\\))$`, "u");

export function isRenderableTone(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 200) return false;
  // No nesting and no functions inside: `url(...)`, `image-set(...)` and
  // `var(--x, url(...))` all need a second set of brackets to say anything, so
  // refusing them is refusing everything that can fetch.
  if (/url\(|image-set|element\(|@import/i.test(trimmed)) return false;
  return TONE.test(trimmed);
}
