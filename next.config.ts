import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native / wasm drivers must stay outside the bundler's module graph.
  serverExternalPackages: ["pg", "@electric-sql/pglite", "@vercel/blob"],
  poweredByHeader: false,
  // The sandbox preview proxies the dev server under *.e2b.app; without this,
  // Next refuses the cross-origin HMR/dev asset requests.
  allowedDevOrigins: ["*.e2b.app", "*.e2b.dev", "localhost", "127.0.0.1"],
  reactStrictMode: true,
  experimental: {
    // The preview route streams bytes back; keep proxy bodies unbounded.
    proxyTimeout: 120_000,
  },
  async headers() {
    return [
      {
        // Platform pages: never cached with a session cookie, never framed by a stranger.
        source: "/:path((?!api/raw).*)",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;
