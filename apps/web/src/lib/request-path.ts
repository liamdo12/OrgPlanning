/**
 * The path a server component is rendering for.
 *
 * Nothing else gives it to them: a server component has no `usePathname`, and
 * the request URL is not otherwise reachable. `src/proxy.ts` sets it on every
 * matched request, and the auth guard reads it so a redirect to the login
 * screen can come back to where the person was.
 *
 * Its own module so the guard does not have to import the middleware entry
 * point — and with it `@supabase/ssr` and `next/server` — for one string.
 */
export const PATHNAME_HEADER = "x-occasion-pathname";
