import Link from "next/link";
import { Pill } from "@occasion/ui";
import { classLabel, type LiveTemplate } from "@occasion/core";

/**
 * The template library (line 1714).
 *
 * The tag on each card is the template's **class**, which is the prototype's
 * `Automatic` / `Vendors` / `Broadcast` — and not, as an earlier reading had
 * it, `Manual`. `Manual` is a tag on the vendor's own screen (line 2644); an
 * administrator's library has no such thing.
 *
 * The class is not decoration. It decides whether a send needs express consent
 * and whether the body may carry a per-recipient secret, so it is the first
 * thing on the card after the name.
 *
 * There is no "+ New template" button, although the prototype draws one (line
 * 1725). A template's allowlist and class are security properties that ship as
 * reviewed code; what an administrator edits is the words. A button that
 * appeared to create one and could not would be worse than its absence.
 */
export function TemplateList({
  templates,
  activeKey,
  audience,
}: {
  templates: readonly LiveTemplate[];
  activeKey: string;
  audience: string;
}) {
  return (
    <div>
      <p className="m-0 mb-[10px] text-[12px] font-bold uppercase tracking-[0.07em] text-muted">
        Templates
      </p>

      <div className="grid gap-[9px]">
        {templates.map((template) => (
          <Link
            key={template.key}
            href={`/admin/email?audience=${audience}&template=${template.key}`}
            className="oc-template-card"
            data-selected={template.key === activeKey ? "true" : "false"}
            aria-current={template.key === activeKey ? "true" : undefined}
          >
            <span className="flex items-baseline justify-between gap-[10px]">
              <span className="text-[14.5px] font-bold">{template.name}</span>
              <Pill tone={template.class === "automatic" ? "success" : "neutral"}>
                {classLabel(template.class)}
              </Pill>
            </span>
            <span className="mt-1 block text-pretty text-[13px] text-muted">
              {template.subject}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
