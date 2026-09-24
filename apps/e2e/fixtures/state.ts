import { fileURLToPath } from "node:url";

/**
 * Where the signed-in sessions are kept between tests.
 *
 * The suite used to sign in at the start of every test, and that is how it
 * discovered `LOGIN_RULE`: ten attempts in fifteen minutes and the eleventh is
 * refused for a quarter of an hour. The platform was right and the suite was
 * wrong — a test run is not a reason to weaken a brute-force limit, and
 * clearing the counter between tests would have meant the limit was never
 * exercised by anything.
 *
 * So each identity signs in once, in `auth.setup.ts`, and the rest of the suite
 * reuses the cookie. The three places that are *about* signing in still do it
 * for real: the setup itself, the redirect-after-login case, and the journey's
 * first step.
 */

const here = fileURLToPath(new URL(".", import.meta.url));

export const ADMIN_STATE = `${here}../.auth/admin.json`;
export const CUSTOMER_STATE = `${here}../.auth/customer.json`;

/**
 * The customer who has planned nothing.
 *
 * A second session rather than a second use of the first: what the screens show
 * an account with no events is a state of its own, and the only way to reach it
 * is to be somebody who has none.
 */
export const NEW_CUSTOMER_STATE = `${here}../.auth/new-customer.json`;

/** No cookies at all: the state an anonymous visitor arrives in. */
export const ANONYMOUS_STATE = { cookies: [], origins: [] };
