import { getEmailView } from "@occasion/core";
import { AdminPage } from "../../_components/admin-page";
import { requireAdminPage } from "../../../../lib/auth-guard";
import { createRequestContext } from "../../../../lib/core";
import { AudienceTabs } from "./_components/audience-tabs";
import { TemplateList } from "./_components/template-list";
import { TemplateEditor } from "./_components/template-editor";
import { RecentlySent } from "./_components/recently-sent";

/** Rendered per request: nothing it shows exists at build time. */
export const dynamic = "force-dynamic";

export const metadata = { title: "Email · Occasion admin" };

/**
 * The prototype's `a_email` screen, made real.
 *
 * Its blurb is kept almost verbatim (line 2671) because it is an accurate
 * description of what the screen does, with one clause added: consent. The
 * prototype's counts are string literals and its send button does nothing;
 * here every number is resolved from the audience that will actually be sent
 * to, and a broadcast to somebody who has not given express consent is refused
 * rather than counted.
 *
 * Which template and audience are open is a query parameter rather than client
 * state, so the screen is server-rendered behind the same gate as the data and
 * a particular template can be linked to.
 */

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

/** Every `?to=` on the URL, which is how a Users-screen button names a recipient. */
function all(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function AdminEmailPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireAdminPage();
  const ctx = createRequestContext();

  const params = await searchParams;
  const requested = first(params["audience"]);
  const templateKey = first(params["template"]);
  // Anything that is not a uuid is dropped rather than refused. This is a query
  // parameter somebody may have edited or a link that outlived an account, and
  // an error page is a worse answer than the screen with nobody preselected.
  const userIds = all(params["to"]).filter((id) => UUID.test(id));

  const view = await getEmailView(ctx, actor, {
    // An audience the URL invented falls back to the default rather than
    // refusing. This is a query parameter somebody may have edited, and an
    // error page is a worse answer than the screen.
    audience: requested === "vendors" || requested === "both" ? requested : "customers",
    ...(templateKey ? { templateKey } : {}),
    ...(userIds.length > 0 ? { userIds } : {}),
  });

  return (
    <AdminPage
      title="Email"
      blurb="Platform email. Pick a template, choose whether it goes to customers, vendors or both, and the merge fields fill in per recipient. A broadcast reaches only the accounts that have given express consent."
    >
      <AudienceTabs audiences={view.audiences} templateKey={view.active.key} />

      <div className="grid items-start gap-[18px] desk:grid-cols-[minmax(290px,1fr)_1.4fr]">
        <TemplateList
          templates={view.templates}
          activeKey={view.active.key}
          audience={view.audience}
        />

        <TemplateEditor
          selected={view.selected}
          template={view.active}
          preview={view.preview}
          fields={view.fields}
          senderFields={view.senderFields}
          notSendable={view.notSendable}
          scopes={view.scopes}
          audience={view.audience}
          secondConfirmationAbove={view.secondConfirmationAbove}
        />
      </div>

      <RecentlySent sends={view.recent} statsAvailable={view.statsAvailable} />
    </AdminPage>
  );
}
