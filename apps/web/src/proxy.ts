import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { PATHNAME_HEADER } from "./lib/request-path";

/**
 * Refreshes the session cookie on the way in, and tells the request where it
 * is going. It does not authorize.
 *
 * Every attempt to gate routes here has the same flaw: this runs before the
 * request reaches the code that knows about roles, and roles live in the
 * database. A check here would have to trust a token claim, which is exactly
 * what cannot be trusted once a role can be revoked. So the only jobs are
 * keeping the session fresh and passing on the path; `requireAdminPage()` and
 * `requireAdminActor()` do the deciding with the real answer.
 */

export async function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set(PATHNAME_HEADER, `${request.nextUrl.pathname}${request.nextUrl.search}`);

  let response = NextResponse.next({ request: { headers } });

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
        // Rebuilt, so the refreshed cookies reach the app — and carrying the
        // same request headers, or the path set above would be lost here.
        response = NextResponse.next({ request: { headers } });
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
