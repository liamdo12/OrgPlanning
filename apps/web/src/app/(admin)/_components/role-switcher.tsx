"use client";

import type { RoleName } from "@occasion/core";
import { switchRoleAction } from "../../(auth)/actions";
import { themeFor } from "../../../lib/role-theme";

/**
 * Switches which role a person is looking through.
 *
 * Presentation and audit provenance only. An administrator who selects
 * "customer" is still an administrator — `requireAdmin` reads the roles they
 * hold, never this — so the switch changes the label on their actions, not what
 * they are allowed to do.
 */
export function RoleSwitcher({ roles, active }: { roles: readonly RoleName[]; active: RoleName }) {
  if (roles.length < 2) return null;

  return (
    <form action={switchRoleAction} className="flex items-center gap-1 text-badge">
      <span className="text-body">Viewing as</span>
      {roles.map((role) => (
        <button
          key={role}
          type="submit"
          name="role"
          value={role}
          // Each chip carries its own theme, so the selected one is tinted in
          // the colour of the role it selects rather than the one in force.
          data-role={themeFor(role)}
          aria-pressed={role === active}
          className={`rounded-pill px-3 py-1 capitalize ${
            role === active ? "bg-role-tint font-bold text-ink" : "text-body"
          }`}
        >
          {role}
        </button>
      ))}
    </form>
  );
}
