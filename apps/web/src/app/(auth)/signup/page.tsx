import { AuthScreen } from "../_components/auth-screen";

export const metadata = { title: "Sign up · Occasion" };

export default function SignupPage() {
  return <AuthScreen mode="signup" next="/" />;
}
