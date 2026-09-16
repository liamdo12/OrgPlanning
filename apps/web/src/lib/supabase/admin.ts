import "server-only";

import { createClient } from "@supabase/supabase-js";
import { getEnv } from "../env";

/**
 * The service-role client.
 *
 * `import "server-only"` is the guard that matters: this key bypasses every
 * check the provider makes, so a build that accidentally pulls this into a
 * client bundle must fail rather than ship.
 *
 * Used only for operations a person cannot perform on their own behalf —
 * inviting an administrator, forcing a sign-out. Never for reading application
 * data, which goes through the pooled `app_rw` connection like everything else.
 */
export function createSupabaseAdminClient() {
  const env = getEnv();

  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
