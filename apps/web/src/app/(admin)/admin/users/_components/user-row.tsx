import Link from "next/link";
import { Avatar, ListRow, StatusBadge } from "@occasion/ui";
import type { AdminUserListItem } from "@occasion/core";
import { StatusActionButton } from "./status-action-button";
import { toneFor } from "./status-tone";

/**
 * One account.
 *
 * Line 1675: a glass card at radius 22, an initials avatar, a two-line
 * identity, the activity line, a role pill, a status badge, and two buttons —
 * `Email` and the contextual one. Cards rather than flush rows, which is what
 * distinguishes this list from the vendor queue next door (line 1645).
 */
export function UserRow({
  user,
  query,
  isSelf,
}: {
  user: AdminUserListItem;
  query: string;
  /**
   * Whether this row is the administrator reading the screen.
   *
   * They get no status action, because every one of them would be refused: an
   * administrator cannot suspend or demote themselves, which is half of what
   * stops the platform being locked out of itself. A button that always fails
   * is worse than no button — it teaches people the screen is broken.
   */
  isSelf: boolean;
}) {
  const href = query ? `/admin/users?${query}&user=${user.id}` : `/admin/users?user=${user.id}`;

  return (
    <li>
      <ListRow
        leading={<Avatar name={user.fullName} />}
        title={
          // The name is the link to the record: a row-wide target would swallow
          // the buttons beside it.
          <Link href={href} scroll={false}>
            {user.fullName}
          </Link>
        }
        subtitle={user.email}
        trailing={
          <>
            <span className="min-w-0 flex-[1_1_150px] text-row text-ink">{user.activity}</span>

            <StatusBadge tone={user.roleLabel === "Customer" ? "success" : "warn"}>
              {user.roleLabel}
            </StatusBadge>

            <StatusBadge tone={toneFor(user.status)}>
              <span className="capitalize">{user.status}</span>
            </StatusBadge>

            {/* Line 1684: every row can start an email, whatever its status. */}
            <Link
              href="/admin/email"
              className="oc-button oc-button--ghost oc-button--sm"
              aria-label={`Email ${user.fullName}`}
            >
              Email
            </Link>

            {isSelf ? (
              <span className="text-row text-body">Signed in as you</span>
            ) : (
              <StatusActionButton userId={user.id} name={user.fullName} action={user.action} />
            )}
          </>
        }
      />
    </li>
  );
}
