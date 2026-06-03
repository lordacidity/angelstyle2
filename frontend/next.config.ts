import type { NextConfig } from "next";
import { loadEnvConfig } from "@next/env";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Single source of truth for env vars lives at phonedeck/.env (one level up
// from this frontend dir) — same file the Phonedeck Express server reads.
// loadEnvConfig is the canonical Next.js loader and populates process.env
// before any module compiles, so NEXT_PUBLIC_* values get inlined into the
// client bundle just like a co-located .env would.
const HERE = path.dirname(fileURLToPath(import.meta.url));
loadEnvConfig(path.resolve(HERE, ".."));

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Cross-Origin-Opener-Policy',   value: 'same-origin' },
          { key: 'Cross-Origin-Embedder-Policy', value: 'credentialless' },
        ],
      },
    ];
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.tikwm.com' },
      { protocol: 'https', hostname: '**.tiktokcdn.com' },
      { protocol: 'https', hostname: '**.tiktokv.com' },
      { protocol: 'https', hostname: '**.tiktokcdn-us.com' },
    ],
  },
};

export default nextConfig;
