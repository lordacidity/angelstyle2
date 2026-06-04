import type { NextConfig } from "next";
import fs from "node:fs";
import path from "node:path";

// Single source of truth for env vars is the repo-root .env (one level above
// this Next app). Next only auto-loads .env from its own project dir, so we load
// the parent's here — early enough for both server-side reads and NEXT_PUBLIC_*
// build-time inlining. Guarded so it's a no-op in production, where the platform
// injects env vars directly and there is no .env file on disk.
const rootEnv = path.join(process.cwd(), "..", ".env");
if (fs.existsSync(rootEnv)) process.loadEnvFile(rootEnv);

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
