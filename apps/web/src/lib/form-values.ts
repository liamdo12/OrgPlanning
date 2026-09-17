/**
 * Reading a form field as text.
 *
 * `FormData.get` answers `string | File | null`, and a `File` stringifies to
 * `[object Object]` — a shape that would sail through a length check and land
 * in the database. Anything that is not text becomes the empty string here, and
 * the caller's own validation refuses it.
 */
export function readString(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}
