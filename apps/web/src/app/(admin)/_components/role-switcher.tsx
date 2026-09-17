"use client";

import { switchRoleAction } from "../../(auth)/actions";
import type { RoleName } from "@occasion/core";

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
    <form action={switchRoleAction} className="flex items-center gap-1 text-xs">
      <span className="opacity-60">Viewing as</span>
      {roles.map((role) => (
        <button
          key={role}
          type="submit"
          name="role"
          value={role}
          aria-pressed={role === active}
          className={`rounded-full px-3 py-1 capitalize ${
            role === active ? "bg-black/10 font-semibold" : "opacity-70"
          }`}
        >
          {role}
        </button>
      ))}
    </form>
  );
}
