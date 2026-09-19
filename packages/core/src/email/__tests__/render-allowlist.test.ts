import { describe, expect, it } from "vitest";
import { ValidationError } from "../../errors.js";
import { MERGE_FIELDS, isRestricted, tokensIn } from "../fields.js";
import {
  assertBodyFields,
  assertNoRestrictedFields,
  escapeHtml,
  render,
  templateHash,
} from "../render.js";
import { builtInTemplates } from "../templates/index.js";

/**
 * The merge-field allowlist, which is the security property this phase adds.
 *
 * Nothing here needs a database. The rules are about what a body may say and
 * what may be poured into it, and both are decidable from the text.
 */

const RESTRICTED = ["payment_link", "verify_link", "card_last4", "bank_last4"];

describe("merge fields", () => {
  it("classifies the four the red team named as restricted, and nothing else", () => {
    const restricted = MERGE_FIELDS.filter((field) => field.class === "restricted").map(
      (field) => field.name,
    );

    expect(restricted.sort()).toEqual([...RESTRICTED].sort());
  });

  it("reads a token with or without the spaces an author types", () => {
    expect(tokensIn("Hi {{first_name}} and {{ last_name }}")).toEqual(["first_name", "last_name"]);
  });

  it("gives every field a sample, so a preview is never half empty", () => {
    for (const field of MERGE_FIELDS) {
      expect(field.sample.length).toBeGreaterThan(0);
    }
  });
});

describe("the allowlist", () => {
  const allowed = ["first_name", "brand_name"];

  it("refuses a body using a field the template does not allow", () => {
    expect(() => assertBodyFields("Hi {{payment_link}}", allowed, "The template")).toThrow(
      ValidationError,
    );
  });

  it("names the offending field, because the author has to fix it", () => {
    expect(() => assertBodyFields("Hi {{grace_deadline}}", allowed, "The template")).toThrow(
      /\{\{grace_deadline\}\}/,
    );
  });

  it("allows a body that stays inside it", () => {
    expect(() =>
      assertBodyFields("Hi {{first_name}}, from {{brand_name}}", allowed, "The template"),
    ).not.toThrow();
  });
});

describe("a broadcast", () => {
  /**
   * The phase's own success criterion, asserted four ways — once per field.
   * A broadcast body is written once and sent to everybody, so a per-recipient
   * secret in one is either a leak or a render failure.
   */
  for (const field of RESTRICTED) {
    it(`cannot be saved carrying {{${field}}} in its body`, () => {
      expect(() =>
        assertNoRestrictedFields("Subject", `Body with {{${field}}}`, [field], "The template"),
      ).toThrow(ValidationError);
    });

    it(`cannot be saved carrying {{${field}}} in its subject`, () => {
      expect(() =>
        assertNoRestrictedFields(`Subject {{${field}}}`, "Body", [field], "The template"),
      ).toThrow(ValidationError);
    });

    it(`cannot be saved with {{${field}}} merely on its allowlist`, () => {
      // The body is clean, so only checking the text would pass this. The
      // allowlist is checked too, because an administrator can widen it as
      // easily as they can edit the words — and a later edit would then be
      // permitted to use the field with nothing left to refuse it.
      expect(() =>
        assertNoRestrictedFields("Subject", "Body", ["first_name", field], "The template"),
      ).toThrow(ValidationError);
    });
  }

  it("is allowed the open fields", () => {
    expect(() =>
      assertNoRestrictedFields(
        "Changes on {{effective_date}}",
        "Hi {{first_name}}",
        ["first_name", "effective_date"],
        "The template",
      ),
    ).not.toThrow();
  });
});

describe("render", () => {
  const template = {
    subject: "Hello {{first_name}}",
    body: "Hi {{first_name}},\n\nYour balance is {{balance_amount}}.",
    allowedFields: ["first_name", "balance_amount"],
  };

  it("fills every field and produces both parts from one body", () => {
    const out = render(
      { ...template, values: { first_name: "Sarah", balance_amount: "C$262.16" } },
      "The template",
    );

    expect(out.subject).toBe("Hello Sarah");
    expect(out.text).toContain("Your balance is C$262.16.");
    expect(out.html).toContain("C$262.16");
    expect(out.html).toContain("<p>");
  });

  it("refuses rather than sending a message with a hole in it", () => {
    expect(() => render({ ...template, values: { first_name: "Sarah" } }, "The template")).toThrow(
      /\{\{balance_amount\}\}/,
    );
  });

  it("treats an empty value as missing, because it reads as one", () => {
    expect(() =>
      render({ ...template, values: { first_name: "Sarah", balance_amount: "" } }, "The template"),
    ).toThrow(ValidationError);
  });

  it("escapes a value that arrives as markup", () => {
    // A display name is whatever somebody typed at signup, so receiving a tag
    // is ordinary — and it must not become markup in a message to somebody
    // else.
    const out = render(
      {
        ...template,
        values: { first_name: "<script>alert(1)</script>", balance_amount: "C$1.00" },
      },
      "The template",
    );

    expect(out.html).not.toContain("<script>");
    expect(out.html).toContain("&lt;script&gt;");
    // The text part is not markup, so escaping it would only put entities in
    // front of a reader using a plain-text client.
    expect(out.text).toContain("<script>");
  });

  it("escapes an ampersand in a business name without double-encoding it", () => {
    expect(escapeHtml("Bloom & Co")).toBe("Bloom &amp; Co");
  });

  it("refuses a field that is not on the allowlist even when a value is supplied", () => {
    expect(() =>
      render(
        {
          subject: "Hello",
          body: "Pay here: {{payment_link}}",
          allowedFields: ["first_name"],
          values: { payment_link: "https://example.test/pay/abc" },
        },
        "The template",
      ),
    ).toThrow(/not in this template's allowed fields/);
  });
});

describe("the template hash", () => {
  it("changes with the words, so an audit entry identifies a version", () => {
    expect(templateHash("Subject", "Body")).not.toBe(templateHash("Subject", "Body."));
    expect(templateHash("Subject", "Body")).toBe(templateHash("Subject", "Body"));
  });
});

describe("every template the platform ships", () => {
  const templates = builtInTemplates();

  it("ships more than a couple, so the assertions below are not vacuous", () => {
    expect(templates.length).toBeGreaterThan(5);
  });

  for (const template of templates) {
    it(`"${template.name}" only uses fields its own allowlist permits`, () => {
      const allowed = new Set(template.allowedFields);
      for (const token of [...tokensIn(template.subject), ...tokensIn(template.body)]) {
        expect({ template: template.key, token, allowed: allowed.has(token) }).toEqual({
          template: template.key,
          token,
          allowed: true,
        });
      }
    });

    it(`"${template.name}" lists no field it does not use`, () => {
      // An allowlist entry that appears nowhere is a permission granted for no
      // reason, and the one most likely to be a restricted field somebody added
      // "just in case".
      const used = new Set([...tokensIn(template.subject), ...tokensIn(template.body)]);
      for (const field of template.allowedFields) {
        expect({ template: template.key, field, used: used.has(field) }).toEqual({
          template: template.key,
          field,
          used: true,
        });
      }
    });

    if (template.class === "broadcast") {
      it(`"${template.name}" is a broadcast and carries no restricted field`, () => {
        expect(template.allowedFields.filter(isRestricted)).toEqual([]);
      });
    }
  }
});
