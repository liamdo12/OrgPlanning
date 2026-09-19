import { ValidationError } from "../errors.js";
import { MERGE_TOKEN, isRestricted, tokensIn } from "./fields.js";

/**
 * Turning a stored body into one message.
 *
 * Three refusals, all of them hard. The alternative to each is a message that
 * goes out anyway, and email is the one thing this platform does that cannot be
 * taken back afterwards.
 *
 * 1. **A token outside the template's allowlist stops the send.** Not dropped,
 *    not left as literal braces — the render throws. Dropping it silently sends
 *    a message with a hole where a deadline was; leaving the braces sends one
 *    that reads as broken software. Both look to the recipient like a mistake
 *    somebody else should have caught, and both are how a field that was never
 *    reviewed reaches a body.
 * 2. **A missing value stops the send.** An allowed field with nothing to put
 *    in it means the caller did not know what it was talking about, and "your
 *    balance of  is due on " is worse than no email.
 * 3. **Every value is escaped before it reaches the HTML.** The values come
 *    from account rows — a display name is whatever somebody typed at signup —
 *    so a name containing a tag is an ordinary thing to receive and must not
 *    become markup in a message sent to somebody else.
 *
 * The text part is not escaped, because it is not markup; escaping it would put
 * `&amp;` in front of readers using a plain-text client.
 */

export type RenderedEmail = {
  subject: string;
  text: string;
  html: string;
};

export type RenderInput = {
  subject: string;
  /** The author's plain-text body. The HTML part is built from it. */
  body: string;
  /** Field names this template may interpolate, without braces. */
  allowedFields: readonly string[];
  values: Readonly<Record<string, string>>;
};

/**
 * Refuses a body that may never be rendered, whatever it is handed.
 *
 * Called when a template is **saved**, so that an author finds out at the
 * moment they can still fix it rather than when a job fails hours later against
 * a body nobody is looking at. Also called before every send, because a
 * template row can be written by a migration or a fixture that never went
 * through the editor.
 */
export function assertBodyFields(
  body: string,
  allowedFields: readonly string[],
  where: string,
): void {
  const allowed = new Set(allowedFields);
  const unknown = tokensIn(body).filter((token) => !allowed.has(token));

  if (unknown.length > 0) {
    throw new ValidationError(
      `${where} uses ${unknown.map((name) => `{{${name}}}`).join(", ")}, which ${
        unknown.length === 1 ? "is" : "are"
      } not in this template's allowed fields.`,
      { body: "disallowed_field" },
    );
  }
}

/**
 * Refuses a marketing body that carries a per-recipient secret.
 *
 * Structural, and checked at author time: a broadcast is composed once and sent
 * to an audience, so there is no recipient whose payment link it could be. The
 * allowlist alone would not stop this — an administrator can put a restricted
 * field in a broadcast's allowlist as easily as they can put it in its body.
 */
export function assertNoRestrictedFields(
  subject: string,
  body: string,
  allowedFields: readonly string[],
  where: string,
): void {
  const offenders = [
    ...new Set([...tokensIn(subject), ...tokensIn(body), ...allowedFields]),
  ].filter(isRestricted);

  if (offenders.length > 0) {
    throw new ValidationError(
      `${where} may not use ${offenders
        .map((name) => `{{${name}}}`)
        .join(
          ", ",
        )}. Those fields are different for every recipient, and a broadcast is written once.`,
      { body: "restricted_field" },
    );
  }
}

/**
 * One message, or a refusal.
 *
 * `where` names the template in whatever it throws, because the caller is
 * usually a job and the error is usually read out of a queue row hours later.
 */
export function render(input: RenderInput, where: string): RenderedEmail {
  assertBodyFields(input.subject, input.allowedFields, where);
  assertBodyFields(input.body, input.allowedFields, where);

  const subject = substitute(input.subject, input.values, where);
  const text = substitute(input.body, input.values, where);

  return { subject, text, html: toHtml(text) };
}

function substitute(
  source: string,
  values: Readonly<Record<string, string>>,
  where: string,
): string {
  const missing: string[] = [];

  const out = source.replace(MERGE_TOKEN, (_match, name: string) => {
    const value = values[name];
    if (value === undefined || value === "") {
      missing.push(name);
      return "";
    }
    return value;
  });

  if (missing.length > 0) {
    throw new ValidationError(
      `${where} has nothing to put in ${[...new Set(missing)]
        .map((name) => `{{${name}}}`)
        .join(", ")}.`,
      { values: "missing" },
    );
  }

  return out;
}

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ESCAPES[character] ?? character);
}

/**
 * The HTML part, built from the plain-text body rather than authored beside it.
 *
 * One body, so the two parts cannot disagree — a recipient reading the text
 * alternative gets the same message, not last month's. Escaping happens here,
 * after substitution, which is what makes it cover the interpolated values as
 * well as the author's own text.
 */
function toHtml(text: string): string {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, "<br />")}</p>`)
    .join("\n");

  return [
    '<div style="font-family: Georgia, serif; font-size: 15px; line-height: 1.6; color: #1F2A24;">',
    paragraphs,
    "</div>",
  ].join("\n");
}

/**
 * A stable fingerprint of what was sent.
 *
 * Recorded on the audit entry for a broadcast, so "which words went to eleven
 * hundred people" has an answer that survives the template being edited
 * afterwards. Not a security boundary — it identifies a version, it does not
 * authenticate one — so a short non-cryptographic digest is honest and enough.
 */
export function templateHash(subject: string, body: string): string {
  const source = `${subject}\u0000${body}`;
  // FNV-1a, 32-bit. Chosen for being obviously a fingerprint rather than
  // something a reader might mistake for a signature.
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
