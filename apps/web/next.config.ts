import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A standalone build runs under plain Node in a container, with no
  // proprietary host runtime — that is what keeps a later move to other
  // infrastructure a redeploy rather than a rewrite.
  output: "standalone",
  // The monorepo root, so the standalone trace collects the workspace packages.
  // fileURLToPath, not URL.pathname: the latter percent-encodes, so a checkout
  // under a path containing a space would silently trace the wrong root.
  outputFileTracingRoot: fileURLToPath(new URL("../..", import.meta.url)),
  // The repo authors its own CLAUDE.md; a generated one alongside it would drift.
  agentRules: false,
  reactStrictMode: true,
  typedRoutes: true,

  /**
   * `/admin` is not a screen; it is the way in.
   *
   * At the routing layer rather than in a page, because a page would render the
   * whole shell and stream it before the redirect reached the browser — a 200
   * carrying 42KB of markup nobody sees, where a 308 costs nothing. The
   * destination gates for itself, so this changes nothing about who may enter:
   * an anonymous visitor lands on the login screen either way, and now returns
   * to the vendor queue rather than to the door.
   *
   * Vendors is the prototype's first admin tab (line 1979) and the queue with
   * work waiting in it.
   */
  redirects: () => [{ source: "/admin", destination: "/admin/vendors", permanent: true }],
};

export default nextConfig;
