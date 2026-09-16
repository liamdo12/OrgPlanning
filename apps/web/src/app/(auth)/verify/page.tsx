export const metadata = { title: "Verify your email · Occasion" };

/**
 * Shown after signup and after a verification link is followed.
 *
 * Deliberately says nothing about whether the address has an account: the same
 * page for both cases, because the difference is an enumeration oracle.
 */
export default function VerifyPage() {
  return (
    <main className="mx-auto max-w-md px-4 py-24 text-center">
      <h1 className="text-2xl font-semibold">Check your email</h1>
      <p className="mt-3 text-sm opacity-70">
        If that address needs confirming, a link is on its way. Follow it to finish setting up your
        account.
      </p>
    </main>
  );
}
