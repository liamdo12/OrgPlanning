import { safeRedirectPath } from "@occasion/core";
import { AuthScreen } from "../_components/auth-screen";
import { getEnv } from "../../../lib/env";

/** Rendered per request: nothing it shows exists at build time. */
export const dynamic = "force-dynamic";

export const metadata = { title: "Log in · Occasion" };

/**
 * Why someone was sent back here. Deliberately vague about the account itself —
 * "that account is suspended" on a login screen answers a question nobody
 * signed in to ask.
 */
const NOTICES: Record<string, string | undefined> = {
  link: "That link is no longer valid. Sign in to carry on.",
  session: "Your session ended. Sign in again.",
};

/**
 * The `next` destination is constrained here, on the server, before it ever
 * reaches a form field. An unchecked one turns a real sign-in on the real
 * domain into a redirect to somewhere else entirely.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  return (
    <AuthScreen
      mode="login"
      next={safeRedirectPath(params["next"], "/")}
      googleEnabled={getEnv().AUTH_GOOGLE_ENABLED}
      notice={NOTICES[String(params["error"] ?? "")]}
    />
  );
}
