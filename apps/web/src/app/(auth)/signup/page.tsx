import { AuthScreen } from "../_components/auth-screen";
import { getEnv } from "../../../lib/env";

/** Rendered per request: nothing it shows exists at build time. */
export const dynamic = "force-dynamic";

export const metadata = { title: "Sign up · Occasion" };

export default function SignupPage() {
  const env = getEnv();
  return (
    <AuthScreen
      mode="signup"
      next="/"
      googleEnabled={env.AUTH_GOOGLE_ENABLED}
      signupOpen={env.AUTH_SIGNUP_OPEN}
    />
  );
}
