"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signInAction, signUpAction, type AuthActionState } from "../actions";

/**
 * The shared sign-in and sign-up screen.
 *
 * Layout follows the prototype's `login` route: a left column carrying the
 * headline, blurb and three trust bullets, and a right column with the tabs and
 * the email form. Role chips appear on signup only.
 *
 * The prototype also shows Google and Apple buttons. Neither is built yet, so
 * neither is rendered — a button that looks real and does nothing is worse than
 * its absence. Recorded in docs/design-gaps.md.
 *
 * Styling is deliberately plain Tailwind against the placeholder tokens — the
 * glass design system replaces it, and inventing glass values here would
 * create a second source of truth for them.
 */

/** Source: the prototype's `authPoints`, lines 2244–2248. */
const TRUST_POINTS = [
  "Deposits, balances and cancellation terms in writing before you pay.",
  "Messages and offers stay on the platform, so nothing gets lost.",
  "One page per event, shared with everyone you book.",
];

/** Source: `authRoles`, line 2253. The only two roles a person may choose. */
const ROLE_CHOICES = [
  { value: "customer", label: "Plan an event" },
  { value: "vendor", label: "Offer services" },
] as const;

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

export function AuthScreen({ mode, next }: { mode: "login" | "signup"; next: string }) {
  const action = mode === "login" ? signInAction : signUpAction;
  const [state, formAction, pending] = useActionState(action, INITIAL);
  const copy = COPY[mode];

  return (
    <main className="mx-auto grid min-h-screen max-w-5xl items-center gap-10 px-4 py-12 md:grid-cols-2 md:gap-16">
      <section>
        <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">{copy.title}</h1>
        <p className="mt-3 max-w-md text-sm opacity-70">{copy.blurb}</p>

        <ul className="mt-8 space-y-3">
          {TRUST_POINTS.map((point) => (
            <li key={point} className="flex gap-3 text-sm">
              <span aria-hidden="true" className="opacity-60">
                ✓
              </span>
              <span className="max-w-sm">{point}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-3xl border border-black/10 bg-white/60 p-6 backdrop-blur md:p-8">
        <nav className="mb-6 flex gap-1 rounded-full bg-black/5 p-1 text-sm" aria-label="Account">
          <Link
            href="/login"
            aria-current={mode === "login" ? "page" : undefined}
            className={`flex-1 rounded-full px-4 py-2 text-center ${
              mode === "login" ? "bg-white font-semibold shadow-sm" : "opacity-70"
            }`}
          >
            Log in
          </Link>
          <Link
            href="/signup"
            aria-current={mode === "signup" ? "page" : undefined}
            className={`flex-1 rounded-full px-4 py-2 text-center ${
              mode === "signup" ? "bg-white font-semibold shadow-sm" : "opacity-70"
            }`}
          >
            Sign up
          </Link>
        </nav>

        <form action={formAction} className="space-y-4">
          <input type="hidden" name="next" value={next} />

          {mode === "signup" ? (
            <fieldset>
              <legend className="mb-2 text-sm font-medium">How will you use Occasion?</legend>
              <div className="flex gap-2">
                {ROLE_CHOICES.map((choice, index) => (
                  <label
                    key={choice.value}
                    className="flex-1 cursor-pointer rounded-full border border-black/10 px-4 py-2 text-center text-sm has-checked:border-black/40 has-checked:font-semibold"
                  >
                    <input
                      type="radio"
                      name="role"
                      value={choice.value}
                      defaultChecked={index === 0}
                      className="sr-only"
                    />
                    {choice.label}
                  </label>
                ))}
              </div>
              {state.fieldErrors?.["role"] ? (
                <p className="mt-2 text-sm text-red-700">Choose one to continue.</p>
              ) : null}
            </fieldset>
          ) : null}

          {mode === "signup" ? (
            <Field
              label="Your name"
              name="fullName"
              type="text"
              autoComplete="name"
              error={state.fieldErrors?.["fullName"]}
            />
          ) : null}

          <Field
            label="Email"
            name="email"
            type="email"
            autoComplete="email"
            error={state.fieldErrors?.["email"]}
          />

          <Field
            label="Password"
            name="password"
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            error={state.fieldErrors?.["password"]}
          />

          {state.error ? (
            // A single message for both an unknown address and a wrong
            // password: saying which was wrong tells an attacker which
            // addresses have accounts.
            <p role="alert" className="text-sm text-red-700">
              {state.error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-2xl bg-[var(--color-forest)] px-4 py-3 text-sm font-semibold text-[var(--color-canvas)] disabled:opacity-60"
          >
            {pending ? "Working…" : copy.submit}
          </button>
        </form>

        {mode === "login" ? (
          <p className="mt-4 text-center text-sm">
            <Link href="/reset" className="underline underline-offset-4 opacity-70">
              Forgotten your password?
            </Link>
          </p>
        ) : null}
      </section>
    </main>
  );
}

function Field({
  label,
  name,
  type,
  autoComplete,
  error,
}: {
  label: string;
  name: string;
  type: string;
  autoComplete: string;
  error?: string | undefined;
}) {
  const id = `field-${name}`;
  const errorId = `${id}-error`;

  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        autoComplete={autoComplete}
        required
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className="w-full rounded-2xl border border-black/10 bg-white/70 px-4 py-3 text-sm"
      />
      {error ? (
        <p id={errorId} className="mt-1 text-sm text-red-700">
          Check this field.
        </p>
      ) : null}
    </div>
  );
}
