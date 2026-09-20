import path from "node:path";
import type { NextConfig } from "next";

/**
 * The browser never talks to the engine directly: every request goes to this server under
 * /api/* and is proxied to the engine. No CORS, no per-device API URL, and the same setup
 * works on a laptop, over the LAN and on the VPS. API_INTERNAL_URL is read where the Next
 * server runs (dev machine: localhost; Docker: the `api` service).
 */
const apiInternalUrl = (process.env.API_INTERNAL_URL ?? "http://localhost:8080").replace(/\/$/, "");

const nextConfig: NextConfig = {
  // Standalone output gives the Docker image a self-contained server. It relies on symlinks,
  // which unprivileged Windows users cannot create, so it is opt-in (the Dockerfile sets it).
  output: process.env.NEXT_STANDALONE === "1" ? "standalone" : undefined,
  outputFileTracingRoot: path.join(__dirname, "../../"),
  transpilePackages: ["@delicate/contracts"],
  poweredByHeader: false,
  reactStrictMode: true,
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiInternalUrl}/:path*` }];
  },
};

export default nextConfig;
