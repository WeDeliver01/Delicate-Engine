import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output gives the Docker image a self-contained server. It relies on symlinks,
  // which unprivileged Windows users cannot create, so it is opt-in (the Dockerfile sets it).
  output: process.env.NEXT_STANDALONE === "1" ? "standalone" : undefined,
  outputFileTracingRoot: path.join(__dirname, "../../"),
  transpilePackages: ["@delicate/contracts"],
  poweredByHeader: false,
  reactStrictMode: true,
};

export default nextConfig;
