import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getEnv } from "../env";

/**
 * A Supabase client bound to the request's cookies.
 *
 * Provider-specific code lives here and in the adapter beside it; nothing in
 * `packages/core` knows Supabase exists, which is what keeps swapping the
 * provider a change to two files rather than to the domain.
 */
export async function createSupabaseServerClient() {
  const env = getEnv();
  const cookieStore = await cookies();

  return createServerClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          for (const { name, value, options } of toSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server components cannot set cookies. The proxy refreshes the
          // session on the way in, so a failure here is the read-only case and
          // not a lost session.
        }
      },
    },
  });
}
