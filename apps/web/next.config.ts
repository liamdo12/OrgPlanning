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
};

export default nextConfig;
