"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Button, GlassPanel, Input } from "@occasion/ui";
import {
  signInAction,
  signInWithGoogleAction,
  signUpAction,
  type AuthActionState,
} from "../actions";
import { RoleChoice } from "./role-choice";

/**
 * The shared sign-in and sign-up screen.
 *
 * Layout follows the prototype's `login` route, lines 488–570: a left column
 * carrying the headline, blurb and three trust bullets, and a glass panel on
 * the right with the tab pair, the provider buttons, a divider and the email
 * form. Role chips appear on signup only.
 *
 * The Google button appears only where Google sign-in is actually configured.
 * The prototype also shows an Apple button (line 519); that provider is not
 * built, and a button that looks real and does nothing is worse than its
 * absence. Recorded in docs/design-gaps.md.
 */

/** Source: the prototype's `authPoints`, lines 2244–2248. */
const TRUST_POINTS = [
  "Deposits, balances and cancellation terms in writing before you pay.",
  "Messages and offers stay on the platform, so nothing gets lost.",
  "One page per event, shared with everyone you book.",
];

const COPY = {
  login: {
    title: "Welcome back.",
    blurb:
      "Sign in to pick up your event plan, answer quotes and manage what you have already booked.",
    submit: "Log in",
  },
  signup: {
    title: "Create your Occasion account.",
    blurb:
      "One account plans events, books vendors and tracks every deposit. Vendors use the same login to manage their services.",
    submit: "Create account",
  },
} as const;

const INITIAL: AuthActionState = {};

export function AuthScreen({
  mode,
  next,
  googleEnabled,
  signupOpen = true,
  notice,
}: {
  mode: "login" | "signup";
  next: string;
  googleEnabled: boolean;
  /**
   * Whether this deployment lets anybody create an account. Courtesy only —
   * the refusal lives in the server action, so a form posted from a stale page
   * or by hand is refused just the same.
   */
  signupOpen?: boolean;
  /** Why the person was sent back here, when something sent them. */
  notice?: string | undefined;
}) {
  const action = mode === "login" ? signInAction : signUpAction;
  const [state, formAction, pending] = useActionState(action, INITIAL);
  const [googleState, googleAction, googlePending] = useActionState(
    signInWithGoogleAction,
    INITIAL,
  );
  const copy = COPY[mode];
  const closed = mode === "signup" && !signupOpen;

  return (
    <main className="mx-auto grid min-h-screen max-w-5xl items-center gap-10 px-4 py-12 desk:grid-cols-2 desk:gap-16">
      <section>
        <h1 className="m-0 font-display text-[clamp(30px,5vw,46px)] font-normal">{copy.title}</h1>
        <p className="mt-4 mb-[22px] max-w-[40ch] text-[15.5px] text-pretty text-body">
          {copy.blurb}
        </p>

        {/* Line 497: an 11px grid capped at 34 characters. */}
        <ul className="m-0 grid max-w-[34ch] list-none gap-[11px] p-0">
          {TRUST_POINTS.map((point) => (
            <li key={point} className="flex items-start gap-[10px] text-[14px] text-body">
              {/* Line 500: a 19px tinted circle, not a bare tick. */}
              <span
                aria-hidden="true"
                className="mt-px grid h-[19px] w-[19px] flex-none place-items-center rounded-pill bg-[#E9F0E2] text-[12px] font-bold text-[#2E5127]"
              >
                ✓
              </span>
              {point}
            </li>
          ))}
        </ul>
      </section>

      {/* Line 507: radius 28, padding that shrinks with the viewport. */}
      <GlassPanel as="section" className="rounded-hero p-[clamp(20px,3.5vw,30px)]">
        {notice ? (
          <p role="status" className="mb-4 rounded-card bg-glass-wash px-4 py-3 text-row">
            {notice}
          </p>
        ) : null}

        {/* Line 508: the tab pair, a pill group with a 4px inset. */}
        <nav
          className="mb-5 flex gap-1 rounded-pill border border-glass-edge-soft bg-glass-wash p-1"
          aria-label="Account"
        >
          <AuthTab href="/login" current={mode === "login"}>
            Log in
          </AuthTab>
          <AuthTab href="/signup" current={mode === "signup"}>
            Sign up
          </AuthTab>
        </nav>

        {googleEnabled ? (
          <>
            <form action={googleAction} className="mb-[18px]">
              <input type="hidden" name="next" value={next} />
              <Button
                type="submit"
                intent="secondary"
                disabled={googlePending}
                className="w-full rounded-card px-[13px] py-[13px] text-control font-semibold"
              >
                <GoogleMark />
                {googlePending ? "Working…" : "Continue with Google"}
              </Button>
            </form>

            {googleState.error ? (
              <p role="alert" className="mb-4 text-row text-status-danger-fg">
                {googleState.error}
              </p>
            ) : null}

            {/* Line 527: a rule either side of the word. */}
            <div className="mb-[18px] flex items-center gap-3">
              <span className="h-px flex-1 bg-[#EFE9DF]" />
              <span className="text-[12px] font-bold tracking-[0.06em] text-body uppercase">
                or email
              </span>
              <span className="h-px flex-1 bg-[#EFE9DF]" />
            </div>
          </>
        ) : null}

        {closed ? (
          <p className="text-row text-body">
            Accounts on this deployment are created by invitation. If you are expecting one, it
            arrives by email with a link that signs you in.
          </p>
        ) : null}

        <form action={formAction} className="grid gap-4" hidden={closed}>
          <input type="hidden" name="next" value={next} />

          {mode === "signup" ? <RoleChoice error={state.fieldErrors?.["role"]} /> : null}

          {mode === "signup" ? (
            <Input
              id="field-fullName"
              name="fullName"
              label="Your name"
              type="text"
              autoComplete="name"
              required
              error={state.fieldErrors?.["fullName"] ? "Check this field." : undefined}
            />
          ) : null}

          <Input
            id="field-email"
            name="email"
            label="Email"
            type="email"
            autoComplete="email"
            placeholder="sarah@example.ca"
            required
            error={state.fieldErrors?.["email"] ? "Check this field." : undefined}
          />

          <Input
            id="field-password"
            name="password"
            label="Password"
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            required
            error={state.fieldErrors?.["password"] ? "Check this field." : undefined}
          />

          {state.error ? (
            // A single message for both an unknown address and a wrong
            // password: saying which was wrong tells an attacker which
            // addresses have accounts.
            <p role="alert" className="text-row text-status-danger-fg">
              {state.error}
            </p>
          ) : null}

          <Button type="submit" intent="primary" size="lg" disabled={pending} className="mt-[6px]">
            {pending ? "Working…" : copy.submit}
          </Button>
        </form>

        {mode === "login" ? (
          <p className="mt-3 mb-0 text-center text-[12.5px]">
            <Link href="/reset" className="font-semibold">
              Forgotten your password?
            </Link>
          </p>
        ) : null}
      </GlassPanel>
    </main>
  );
}

/** One half of the tab pair. A link, because each mode has its own URL. */
function AuthTab({
  href,
  current,
  children,
}: {
  href: string;
  current: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={`flex-1 rounded-pill py-[10px] text-center text-row font-bold ${
        current ? "bg-role text-surface" : "text-ink"
      }`}
    >
      {children}
    </Link>
  );
}

/** Source: the provider mark at line 516, transcribed path for path. */
function GoogleMark() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true" className="flex-none">
      <path
        fill="#4285F4"
        d="M23 12.2c0-.8-.1-1.6-.2-2.3H12v4.4h6.1a5.3 5.3 0 0 1-2.3 3.5v2.9h3.7c2.2-2 3.5-5 3.5-8.5z"
      />
      <path
        fill="#34A853"
        d="M12 23.5c3.2 0 5.8-1 7.5-2.8l-3.7-2.9c-1 .7-2.3 1.1-3.8 1.1-3 0-5.5-2-6.4-4.7H1.8v3a11.5 11.5 0 0 0 10.2 6.3z"
      />
      <path fill="#FBBC05" d="M5.6 14.2a6.9 6.9 0 0 1 0-4.4v-3H1.8a11.5 11.5 0 0 0 0 10.4z" />
      <path
        fill="#EA4335"
        d="M12 5.1c1.7 0 3.2.6 4.4 1.7l3.3-3.3A11.5 11.5 0 0 0 1.8 6.8l3.8 3a6.8 6.8 0 0 1 6.4-4.7z"
      />
    </svg>
  );
}
