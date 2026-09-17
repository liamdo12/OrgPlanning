import { AuthScreen } from "../_components/auth-screen";
import { getEnv } from "../../../lib/env";

/** Rendered per request: nothing it shows exists at build time. */
export const dynamic = "force-dynamic";

export const metadata = { title: "Sign up · Occasion" };

export default function SignupPage() {
  return <AuthScreen mode="signup" next="/" googleEnabled={getEnv().AUTH_GOOGLE_ENABLED} />;
}
