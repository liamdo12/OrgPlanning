import { NextResponse, type NextRequest } from "next/server";
import { markEmailVerified, getActor, safeRedirectPath } from "@occasion/core";
import { createRequestContext } from "../../../lib/core";
import { createSupabaseServerClient } from "../../../lib/supabase/server";

/**
 * Where the provider's confirmation, recovery and OAuth links land.
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

  // A session that owes a second factor is not finished. Checked before
  // anything else, because until it is answered the domain reports this caller
  // as anonymous and every branch below would read that as "not signed in".
  const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (
    assurance &&
    assurance.nextLevel === "aal2" &&
    assurance.nextLevel !== assurance.currentLevel
  ) {
    return NextResponse.redirect(
      new URL(`/mfa/challenge?next=${encodeURIComponent(next)}`, url.origin),
    );
  }

  // The provider now vouches for the address; record it on our own row so the
  // account becomes usable.
  const ctx = createRequestContext();
  const actor = await getActor(ctx);

  if (actor.kind === "user") {
    await markEmailVerified(ctx, actor.userId);
    return NextResponse.redirect(new URL(next, url.origin));
  }

  // Signed in at the provider, unknown here: a first Google sign-in, with no
  // account to bind to. The role still has to be asked for, so send them to the
  // one page that asks it rather than inventing one.
  return NextResponse.redirect(new URL(`/welcome?next=${encodeURIComponent(next)}`, url.origin));
}
