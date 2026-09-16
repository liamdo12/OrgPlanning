import { ResetForm } from "../_components/reset-form";

export const metadata = { title: "Reset your password · Occasion" };

export default function ResetPage() {
  return (
    <main className="mx-auto max-w-md px-4 py-24">
      <h1 className="text-2xl font-semibold">Reset your password</h1>
      <p className="mt-3 text-sm opacity-70">
        Enter your email and we will send a link if there is an account to send it to.
      </p>
      <ResetForm />
    </main>
  );
}
