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

// One source tree, two sites. The clipper page at pauv.io/clipping is this same
// app, built with NEXT_PUBLIC_APP=clippers on its own Vercel project. basePath
// puts that build's pages, its /_next assets and its API routes all under
// /clipping/*, so pauv.io forwards one prefix and nothing of ours collides with
// its own routes. src/lib/clipping.ts reads the same flag for the URLs Next does
// not prefix by itself (bare fetches, image src, audio src) — keep the two in step.
const CLIPPERS = process.env.NEXT_PUBLIC_APP === "clippers";

const nextConfig: NextConfig = {
  ...(CLIPPERS ? { basePath: "/clipping" } : {}),
  poweredByHeader: false,
  // The Pricer reads its master list (and, once, its two seed CSVs) from disk at request time. Vercel only ships
  // files the bundler can see, so list them for the three routes that read them (src/lib/pricer/pipeline.js).
  outputFileTracingIncludes: {
    '/api/pricer/config': ['./src/lib/pricer/data/*.csv'],
    '/api/pricer/price': ['./src/lib/pricer/data/*.csv'],
    '/api/pricer/log': ['./src/lib/pricer/data/*.csv'],
  },
  serverExternalPackages: ['ffmpeg-static', 'ffprobe-static', 'fluent-ffmpeg', 'youtube-dl-exec', '@fal-ai/client'],
  // The password middleware sits in front of every route, and Next buffers a request body
  // through it only up to 10MB by default — past that the route gets it cut short. The Music
  // section uploads whole songs (a WAV runs to tens of MB) to /api/charts/upload-audio, so
  // raise it here rather than take that route out from behind the password.
  experimental: {
    proxyClientMaxBodySize: '200mb',
  },
  // The Aier studio (YouTube download → freeze frame → Kling → render/export) shells out to
  // python3/yt-dlp + ffmpeg, writes to a persistent disk, and tracks long-running jobs in an
  // in-process map — none of which exist on Vercel's serverless model (step 1 dies at
  // `env: 'python3': No such file or directory`). It runs on Railway instead (see
  // RAILWAY_DEPLOY.md). When this app is served from Vercel, set AIER_RAILWAY_URL to the
  // Railway service URL and we proxy the studio's backend there so /ai-maker keeps working
  // under the Vercel domain. The page itself is static client JS, so only the API is proxied.
  // Leave AIER_RAILWAY_URL UNSET on Railway and in local dev so the routes resolve in-process
  // (a value there would make the backend proxy to itself). rewrites() is evaluated at BUILD
  // time, so the var must be present when Vercel builds — change it → redeploy.
  async rewrites() {
    const backend = (process.env.AIER_RAILWAY_URL || '').replace(/\/+$/, '');
    if (!backend) return [];
    return {
      // beforeFiles so these win over this app's own /api/aier/* route handlers, which would
      // otherwise run locally on Vercel and fail. First match wins within the phase, so the
      // grab self-rewrite below shadows the stateless pure-JS downloader from the catch-all and
      // keeps it on Vercel — it needs no python3 and streams large files, so don't double-hop it.
      beforeFiles: [
        { source: '/api/aier/youtube/grab', destination: '/api/aier/youtube/grab' },
        { source: '/api/aier/:path*', destination: `${backend}/api/aier/:path*` },
      ],
    };
  },
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
