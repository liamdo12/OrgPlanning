"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Dialog, Input, Toast, ToastRegion } from "@occasion/ui";
import type { RoleName } from "@occasion/core";
import { grantRoleAction, revokeRoleAction, type UserActionState } from "../actions";

/**
 * Granting and revoking a role.
 *
 * `customer` is absent on purpose: it is what somebody chooses for themselves
 * at signup, and it is the role their orders and events hang off. Only `vendor`
 * and `admin` are an administrator's to move, and the domain refuses the rest
 * whatever this renders.
 *
 * Granting `admin` is the one action on this screen that creates authority
 * rather than removing it, so it asks the operator to type the account's own
 * address. The check is enforced in the domain too — a confirmation a form
 * enforces is one a direct POST skips.
 */

const INITIAL: UserActionState = {};

export function RoleControls({
  userId,
  email,
  grantable,
  revocable,
}: {
  userId: string;
  email: string;
  grantable: readonly RoleName[];
  revocable: readonly RoleName[];
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<RoleName | null>(null);
  const [outcome, setOutcome] = useState<UserActionState | null>(null);

  const [, grant, granting] = useActionState(async (previous: UserActionState, form: FormData) => {
    const next = await grantRoleAction(previous, form);
    setOutcome(next);
    if (!next.error) router.refresh();
    return next;
  }, INITIAL);

  const [, revoke, revoking] = useActionState(async (previous: UserActionState, form: FormData) => {
    const next = await revokeRoleAction(previous, form);
    setOutcome(next);
    if (!next.error) router.refresh();
    return next;
  }, INITIAL);

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {grantable.map((role) =>
          role === "admin" ? (
            <Button key={role} intent="secondary" size="sm" onClick={() => setConfirming(role)}>
              Grant admin
            </Button>
          ) : (
            <form key={role} action={grant}>
              <input type="hidden" name="userId" value={userId} />
              <input type="hidden" name="role" value={role} />
              <Button type="submit" intent="secondary" size="sm" disabled={granting}>
                Grant {role}
              </Button>
            </form>
          ),
        )}

        {revocable.map((role) => (
          <form key={role} action={revoke}>
            <input type="hidden" name="userId" value={userId} />
            <input type="hidden" name="role" value={role} />
            <Button type="submit" intent="danger" size="sm" disabled={revoking}>
              Revoke {role}
            </Button>
          </form>
        ))}

        {grantable.length === 0 && revocable.length === 0 ? (
          <p className="m-0 text-row text-body">No roles to change on this account.</p>
        ) : null}
      </div>

      <p className="m-0 text-row text-body">
        A role change ends this person&rsquo;s sessions, so it takes effect on their next request
        rather than whenever their current one would have expired.
      </p>

      <AdminGrantDialog
        open={confirming === "admin"}
        onClose={() => setConfirming(null)}
        onDone={(result) => {
          setConfirming(null);
          setOutcome(result);
          router.refresh();
        }}
        userId={userId}
        email={email}
      />

      {outcome?.error || outcome?.message ? (
        <ToastRegion>
          <Toast tone={outcome.error ? "danger" : "success"} onDismiss={() => setOutcome(null)}>
            {outcome.error ?? outcome.message}
          </Toast>
        </ToastRegion>
      ) : null}
    </div>
  );
}

/**
 * The typed confirmation for an admin grant.
 *
 * Typing the address is a deliberate speed bump: it is the difference between
 * clicking the wrong row and giving the wrong person the run of the platform.
 */
function AdminGrantDialog({
  open,
  onClose,
  onDone,
  userId,
  email,
}: {
  open: boolean;
  onClose: () => void;
  onDone: (state: UserActionState) => void;
  userId: string;
  email: string;
}) {
  const [state, submit, pending] = useActionState(
    async (previous: UserActionState, form: FormData) => {
      const next = await grantRoleAction(previous, form);
      if (!next.error) onDone(next);
      return next;
    },
    INITIAL,
  );

  return (
    <Dialog open={open} onClose={onClose} title="Grant administrator">
      <form action={submit}>
        <input type="hidden" name="userId" value={userId} />
        <input type="hidden" name="role" value="admin" />

        <p className="m-0 mb-4 max-w-[54ch] text-[14px] text-pretty text-ink">
          An administrator can see and change every account, vendor and order on the platform, and
          can grant this to somebody else. Type <strong>{email}</strong> to confirm.
        </p>

        <Input
          id={`confirm-admin-${userId}`}
          name="confirmation"
          label="Account email"
          autoComplete="off"
          required
          {...(state.error ? { error: state.error } : {})}
        />

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button type="button" intent="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" intent="primary" disabled={pending}>
            {pending ? "Working…" : "Grant administrator"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
