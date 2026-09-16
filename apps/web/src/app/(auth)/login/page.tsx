import { safeRedirectPath } from "@occasion/core";
import { AuthScreen } from "../_components/auth-screen";

export const metadata = { title: "Log in · Occasion" };

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
  return <AuthScreen mode="login" next={safeRedirectPath(params["next"], "/")} />;
}
