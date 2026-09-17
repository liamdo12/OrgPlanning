import type { ReactNode } from "react";
import { PageHeader, Toolbar } from "@occasion/ui";

/**
 * The scaffolding every admin screen plugs into.
 *
 * Title, blurb, an action slot on the title's row, and a toolbar slot for the
 * filters that sit above a list — which is the shape of every admin screen in
 * the prototype (lines 1659–1672 for Users, and the same again for Vendors and
 * Orders).
 *
 * A component rather than a convention so the gap between the heading and the
 * filters is decided once. Screens that want something else use `PageHeader`
 * directly; this one exists for the four that do not.
 */
export function AdminPage({
  title,
  blurb,
  actions,
  toolbar,
  children,
}: {
  title: ReactNode;
  blurb?: ReactNode;
  actions?: ReactNode;
  toolbar?: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <PageHeader title={title} blurb={blurb} actions={actions} />
      {toolbar ? <Toolbar>{toolbar}</Toolbar> : null}
      {children}
    </>
  );
}
