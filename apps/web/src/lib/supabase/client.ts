"use client";

import { createBrowserClient } from "@supabase/ssr";

/**
 * The browser-side client.
 *
 * Holds only the anonymous key. It can start a sign-in and read its own
 * session; it cannot reach application data, because row-level security denies
 * `anon` everything and the schema grants it nothing.
 */
export function createSupabaseBrowserClient(url: string, anonKey: string) {
  return createBrowserClient(url, anonKey);
}
