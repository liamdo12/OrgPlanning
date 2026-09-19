import Link from "next/link";
import { Avatar, StatusBadge } from "@occasion/ui";
import type { UserDetail } from "@occasion/core";
import { ConsentControl } from "./consent-control";
import { RoleControls } from "./role-controls";
import { StatusActionButton } from "./status-action-button";
import { toneFor } from "./status-tone";

/**
 * One account's whole record.
 *
 * An addition beyond the prototype, which has no account detail view — recorded
 * in `docs/design-gaps.md`. It is also what makes the decision not to build
 * impersonation hold (V-07): everything somebody would sign in as another
 * person to find out is here instead, which is why it carries the events, the
 * orders and the audit trail rather than just the roles.
 */

const dateFormat = new Intl.DateTimeFormat("en-CA", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "America/Toronto",
});

const dayFormat = new Intl.DateTimeFormat("en-CA", {
  dateStyle: "medium",
  timeZone: "America/Toronto",
});

function when(value: Date | null): string {
  return value ? dateFormat.format(value) : "—";
}

function money(cents: bigint, currency: string): string {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(
    Number(cents) / 100,
  );
}

/** The reason recorded on an audit row, when the decision needed one. */
function reasonOf(after: unknown): string | null {
  if (typeof after !== "object" || after === null) return null;
  const reason = (after as { reason?: unknown }).reason;
  return typeof reason === "string" && reason.length > 0 ? reason : null;
}

export function UserDetailPanel({ detail, isSelf }: { detail: UserDetail; isSelf: boolean }) {
  const { user, createdAt, memberships, events, orders, orderTotal, audit } = detail;

  return (
    <div className="grid gap-6">
      <section className="grid gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Avatar name={user.fullName} />
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-bold">{user.email}</span>
            <span className="block text-row text-body">{user.activity}</span>
          </span>
          <StatusBadge tone={toneFor(user.status)}>
            <span className="capitalize">{user.status}</span>
          </StatusBadge>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Nothing an administrator can do to their own account from here:
              suspending or demoting yourself is refused by the domain, and it
              is refused because it is how the last administrator disappears. */}
          {isSelf ? (
            <p className="m-0 text-row text-body">
              This is your own account. Another administrator has to make changes to it.
            </p>
          ) : (
            <>
              <StatusActionButton userId={user.id} name={user.fullName} action={user.action} />
              <Link
                href={`/admin/email?to=${user.id}`}
                className="oc-button oc-button--ghost oc-button--sm"
              >
                Email
              </Link>
            </>
          )}
        </div>
      </section>

      <section>
        <h3 className="m-0 mb-2 text-[15px] font-bold">Account</h3>
        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[14px]">
          <dt className="text-body">Roles</dt>
          <dd className="m-0">{user.roles.length > 0 ? user.roles.join(", ") : "None"}</dd>
          <dt className="text-body">Joined</dt>
          <dd className="m-0">{when(createdAt)}</dd>
          <dt className="text-body">Last seen</dt>
          {/* Nothing writes `users.last_seen_at` yet — saying "never" would be a
              claim about the person rather than about the column. */}
          <dd className="m-0">{user.lastSeenAt ? when(user.lastSeenAt) : "Not recorded yet"}</dd>
        </dl>
      </section>

      <section>
        <h3 className="m-0 mb-2 text-[15px] font-bold">Roles</h3>
        {isSelf ? (
          <p className="m-0 text-[14px] text-body">
            You cannot change your own roles. Revoking your own administrator role is how the last
            one disappears, so it takes a second administrator.
          </p>
        ) : (
          <RoleControls
            userId={user.id}
            email={user.email}
            grantable={detail.grantableRoles}
            revocable={detail.revocableRoles}
          />
        )}
      </section>

      <ConsentControl userId={user.id} consent={detail.marketingConsent} />

      <section>
        <h3 className="m-0 mb-2 text-[15px] font-bold">Businesses ({memberships.length})</h3>
        {memberships.length === 0 ? (
          <p className="m-0 text-[14px] text-body">This person does not work for a vendor.</p>
        ) : (
          <ul className="m-0 grid list-none gap-1 p-0 text-[14px]">
            {memberships.map((membership) => (
              <li key={membership.vendorId}>
                <Link href={`/admin/vendors?vendor=${membership.vendorId}`}>
                  {membership.vendorName}
                </Link>
                <span className="text-body">
                  {" "}
                  · {membership.memberRole} · {membership.vendorStatus}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="m-0 mb-2 text-[15px] font-bold">Events ({events.length})</h3>
        {events.length === 0 ? (
          <p className="m-0 text-[14px] text-body">No events planned.</p>
        ) : (
          <ul className="m-0 grid list-none gap-1 p-0 text-[14px]">
            {events.map((event) => (
              <li key={event.id}>
                <span className="font-bold">{event.name}</span>
                <span className="text-body">
                  {" "}
                  · {dayFormat.format(new Date(event.eventDate))}
                  {event.guestCount ? ` · ${event.guestCount} guests` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="m-0 mb-2 text-[15px] font-bold">
          Orders ({orders.length}) · {orderTotal}
        </h3>
        {orders.length === 0 ? (
          <p className="m-0 text-[14px] text-body">Nothing booked.</p>
        ) : (
          <ul className="m-0 grid list-none gap-1 p-0 text-[14px]">
            {orders.map((order) => (
              <li key={order.id}>
                <span className="font-bold">{order.reference}</span>
                <span className="text-body">
                  {" "}
                  · {order.vendorName} · {money(order.total, order.currency)} ·{" "}
                  {order.state.replaceAll("_", " ")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="m-0 mb-2 text-[15px] font-bold">History</h3>
        {audit.length === 0 ? (
          <p className="m-0 text-[14px] text-body">
            Nothing has been done to this account since it was made.
          </p>
        ) : (
          <ol className="m-0 grid list-none gap-2 p-0 text-[14px]">
            {audit.map((entry) => (
              <li key={entry.id}>
                <span className="font-bold">{entry.action.replace("identity.", "")}</span>{" "}
                <span className="text-body">
                  {/* The role is recorded as well as the person: once somebody
                      can hold more than one, "who did this" is not answerable
                      by the account alone. */}
                  by {entry.actorEmail ?? "a removed account"}
                  {entry.actingRole ? ` as ${entry.actingRole}` : ""}
                </span>
                {reasonOf(entry.after) ? (
                  <span className="block text-[14px] text-ink">{reasonOf(entry.after)}</span>
                ) : null}
                <span className="block text-row text-body">{when(entry.createdAt)}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
