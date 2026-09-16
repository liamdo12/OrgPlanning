import { NextResponse, type NextRequest } from "next/server";
import { markEmailVerified, getActor, safeRedirectPath } from "@occasion/core";
import { createRequestContext } from "../../../lib/core";
import { createSupabaseServerClient } from "../../../lib/supabase/server";

/**
 * Where the provider's confirmation and recovery links land.
 *
 * Without this an account created by signup stays `unverified` for ever and is
 * refused on every route — a signup that completes and then cannot be used.
 *
 * A route handler, not a page: it exchanges a one-time code for a session and
 * then redirects, and it must run on every visit rather than be cached.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const next = safeRedirectPath(url.searchParams.get("next"), "/");

  const supabase = await createSupabaseServerClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return NextResponse.redirect(new URL("/login?error=link", url.origin));
  } else if (tokenHash && type === "email") {
    const { error } = await supabase.auth.verifyOtp({ type: "email", token_hash: tokenHash });
    if (error) return NextResponse.redirect(new URL("/login?error=link", url.origin));
  } else {
    return NextResponse.redirect(new URL("/login?error=link", url.origin));
  }

  // The provider now vouches for the address; record it on our own row so the
  // account becomes usable.
  const ctx = createRequestContext();
  const actor = await getActor(ctx);
  if (actor.kind === "user") {
    await markEmailVerified(ctx, actor.userId);
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
