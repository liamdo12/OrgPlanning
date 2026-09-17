import { cx } from "../lib/cx";

/**
 * Initials on a solid tone.
 *
 * Line 1676: a 40px circle, white initials at 14px/700. The prototype assigns
 * each person a tone by hand; six of them appear across the admin user list
 * (lines 2629–2634), and they are the palette here.
 *
 * The tone is derived from the name rather than passed in, so the same person
 * is the same colour on every screen without anybody storing a colour. It is
 * decoration: `aria-hidden`, because the name is always beside it.
 */

/**
 * Source: the `tone` values on `adminUsers`, lines 2629–2634.
 *
 * Five of the prototype's six. The sixth, `#C2603F`, gives white initials a
 * contrast ratio of 4.17 — under AA for 14px bold text — so it is not in the
 * list. Recorded in docs/design-gaps.md.
 */
export const AVATAR_TONES = ["#1F4D3A", "#6E3318", "#8A3D1E", "#5C6B62", "#3C4A43"] as const;

/** Every one of these clears AA against white, which is why the list is closed. */
function toneFor(seed: string): string {
  let hash = 0;
  for (const character of seed) {
    hash = (hash * 31 + character.codePointAt(0)!) % 100_000;
  }
  return AVATAR_TONES[hash % AVATAR_TONES.length] as string;
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase() || "?";
}

export function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cx("oc-avatar", className)}
      style={{ background: toneFor(name) }}
    >
      {initialsOf(name)}
    </span>
  );
}
