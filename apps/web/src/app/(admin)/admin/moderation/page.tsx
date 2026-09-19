import { EmptyState } from "@occasion/ui";
import {
  CONTENT_TARGETS,
  contentTargetLabel,
  listReports,
  type ContentTarget,
} from "@occasion/core";
import { AdminPage } from "../../_components/admin-page";
import { requireAdminPage } from "../../../../lib/auth-guard";
import { createRequestContext } from "../../../../lib/core";
import { ReportFilters, type FilterChoice } from "./_components/report-filters";
import { ReportCard } from "./_components/report-card";

/** Rendered per request: nothing it shows exists at build time. */
export const dynamic = "force-dynamic";

export const metadata = { title: "Moderation · Occasion admin" };

/**
 * The reported-content queue.
 *
 * A screen the prototype never drew — the business proposal asks for it, and it
 * is built from the same tokens and surfaces as the five beside it. Recorded in
 * `docs/design-gaps.md`.
 *
 * Cards rather than a table: what is being decided is a paragraph somebody
 * wrote, and a queue that shows the first line of it is a queue where decisions
 * are made about the first line.
 */

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

/**
 * The filter from the URL.
 *
 * Anything unrecognised falls back to the waiting queue rather than an error
 * page: this is a parameter somebody may have edited or a link that outlived a
 * rename, and the work still needs doing either way.
 */
type Show = ContentTarget | "open" | "all";

function showFrom(value: string): Show {
  if (value === "all") return "all";
  return CONTENT_TARGETS.find((target) => target === value) ?? "open";
}

function sentenceCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export default async function AdminModerationPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const actor = await requireAdminPage();
  const ctx = createRequestContext();

  const params = await searchParams;
  const show = showFrom(first(params["show"]));

  const list = await listReports(ctx, actor, {
    ...(show === "open" ? { open: true } : {}),
    ...(show !== "open" && show !== "all" ? { targetType: show } : {}),
  });

  // The chip counts come from one unfiltered read rather than a query per chip.
  // Four counts and four round trips is the shape that becomes an N+1 the first
  // time somebody adds a fifth kind of content.
  const everything = show === "all" ? list : await listReports(ctx, actor, {});

  const choices: readonly FilterChoice[] = [
    { value: "open", label: "Waiting", count: everything.open },
    { value: "all", label: "All", count: everything.total },
    ...CONTENT_TARGETS.map((target) => ({
      value: target,
      // "a review" is how the domain phrases it in a sentence; a chip is a
      // heading, so the article comes off and the first letter goes up.
      label: sentenceCase(contentTargetLabel(target).replace(/^an? /, "")),
      count: everything.rows.filter((row) => row.targetType === target).length,
    })),
  ];

  return (
    <AdminPage
      title="Moderation"
      blurb="Content somebody reported. Read what was written, then keep it, hide it or remove it — hiding is reversible and removing is not."
      toolbar={<ReportFilters active={show} choices={choices} />}
    >
      {list.rows.length === 0 ? (
        <EmptyState
          title={show === "open" ? "Nothing waiting" : "Nothing here"}
          blurb={
            show === "open"
              ? "Every report has been decided. New ones arrive when somebody reports a review, a message or a business's profile line."
              : "No report matches this filter."
          }
        />
      ) : (
        <div className="grid gap-4">
          {list.rows.map((report) => (
            <ReportCard key={report.id} report={report} />
          ))}
        </div>
      )}
    </AdminPage>
  );
}
