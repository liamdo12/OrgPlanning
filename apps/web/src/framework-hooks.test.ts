import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The two files Next only runs if they are in the right place.
 *
 * With a `src/` directory, Next looks for `proxy.ts` and `instrumentation.ts`
 * inside it and nowhere else. At the package root they are ordinary modules
 * that nothing imports, so they do not fail — they silently never run, and the
 * guarantee each one carries quietly stops existing.
 *
 * This repository has been caught by that twice. Session refresh was absent for
 * two phases because the proxy sat at the root. Boot-time environment
 * validation had never once run for the same reason: a container configured
 * `APP_TIER=production` with the clock override enabled was supposed to refuse
 * to start, and instead started, served every request with a 500, and stayed
 * up — alive to an orchestrator, useless to everybody else.
 *
 * Neither failure is visible in a diff, in a type error, or in any test of the
 * behaviour itself, because the behaviour is correct; only its location is
 * wrong. So the location is what this asserts.
 */

const appRoot = fileURLToPath(new URL("..", import.meta.url));

const HOOKS = ["proxy.ts", "instrumentation.ts"] as const;

describe("framework hook placement", () => {
  it.each(HOOKS)("keeps %s under src/, where Next looks for it", (hook) => {
    expect(existsSync(`${appRoot}src/${hook}`)).toBe(true);
  });

  it.each(HOOKS)("has no copy of %s at the package root, which never runs", (hook) => {
    // A file in both places is worse than one in the wrong place: the root copy
    // reads as live, and editing it changes nothing at all.
    expect(existsSync(`${appRoot}${hook}`)).toBe(false);
  });
});
