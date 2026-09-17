/**
 * Joins class names, dropping anything falsy.
 *
 * Small enough to own: a dependency for this would be one more thing to keep
 * current in a package whose whole job is not changing under the app.
 */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
