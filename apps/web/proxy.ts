import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refreshes the session cookie on the way in. It does not authorize.
 *
 * Every attempt to gate routes here has the same flaw: this runs before the
 * request reaches the code that knows about roles, and roles live in the
 * database. A check here would have to trust a token claim, which is exactly
 * what cannot be trusted once a role can be revoked. So the only job is
 * keeping the session fresh, and `(admin)/layout.tsx` does the gating with the
 * real answer.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env["SUPABASE_URL"];
  const anonKey = process.env["SUPABASE_ANON_KEY"];
  if (!url || !anonKey) return response;

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        for (const { name, value } of toSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of toSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // Touching the user is what triggers the refresh; the answer is discarded
  // because nothing here is allowed to act on it.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    // Everything except static assets and image requests, which carry no
    // session worth refreshing.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2)$).*)",
  ],
};
