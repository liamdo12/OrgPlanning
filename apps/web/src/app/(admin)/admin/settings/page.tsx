import { GlassCard, StatusBadge } from "@occasion/ui";
import { listPlatformSettings } from "@occasion/core";
import { AdminPage } from "../../_components/admin-page";
import { requireAdminPage } from "../../../../lib/auth-guard";
import { createRequestContext } from "../../../../lib/core";
import { formatMoment } from "../../../../lib/format-moment";
import { SettingForm } from "./_components/setting-form";

/** Rendered per request: nothing it shows exists at build time. */
export const dynamic = "force-dynamic";

export const metadata = { title: "Settings · Occasion admin" };

/**
 * The platform's own numbers.
 *
 * A screen the prototype never drew. Five of these are read when a booking is
 * priced, so changing one changes what the next booking costs — and three are
 * decided somewhere else and say so instead of offering a field that would do
 * nothing. That distinction is the whole reason this screen is worth having:
 * the alternative is a form over a table nobody consults.
 *
 * Every change is audited with its before and after, which is what makes a
 * commission rate somebody can edit safe to have at all.
 */
export default async function AdminSettingsPage() {
  const actor = await requireAdminPage();
  const ctx = createRequestContext();

  const settings = await listPlatformSettings(ctx, actor);

  return (
    <AdminPage
      title="Settings"
      blurb="What the platform charges and how far ahead it charges it. Changing one of these changes the next booking, not the ones already taken."
    >
      <div className="grid gap-4">
        {settings.map((setting) => (
          <GlassCard key={setting.key} as="section" className="grid gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="m-0 text-base font-semibold">{setting.label}</h3>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-lg font-semibold tabular-nums">{setting.display}</span>
                {setting.editable ? null : <StatusBadge tone="neutral">Set elsewhere</StatusBadge>}
              </div>
            </div>

            <p className="m-0 text-sm opacity-80">{setting.description}</p>
            <p className="m-0 text-xs opacity-70">{setting.source}</p>

            {setting.editable ? <SettingForm setting={setting} /> : null}

            {setting.updatedAt ? (
              <p className="m-0 text-xs opacity-70">
                Last changed {formatMoment(setting.updatedAt)}
              </p>
            ) : null}
          </GlassCard>
        ))}
      </div>
    </AdminPage>
  );
}
