import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  trailingSlash: true,
  allowedDevOrigins: ["*.replit.dev", "*.worf.replit.dev"],

  async rewrites() {
    const base = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
    const dirs = ["admin", "users", "settings"];
    return [
      { source: "/api/:path*", destination: `${base}/api/:path*` },
      { source: "/static/:path*", destination: `${base}/static/:path*` },
      // Django runs APPEND_SLASH=False and every admin URL ends in a slash, but
      // Next (trailingSlash:true) strips the trailing slash off :path* matches.
      // Re-add it: exact roots first, then sub-paths with the slash restored.
      ...dirs.map((d) => ({ source: `/${d}/`, destination: `${base}/${d}/` })),
      ...dirs.map((d) => ({ source: `/${d}/:path*`, destination: `${base}/${d}/:path*/` })),
    ];
  },
};

export default nextConfig;