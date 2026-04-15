import { readFileSync } from 'node:fs';

import type { NextConfig } from 'next';

/**
 * `output: 'standalone'` is opt-in via the `BUILD_STANDALONE`
 * environment variable so it only runs during the Docker build, where
 * we want a minimal self-contained `.next/standalone/` server. Local
 * development and Playwright E2E use the regular `next start` server
 * (which warns if standalone is unconditionally enabled).
 *
 * See:
 * https://nextjs.org/docs/app/api-reference/config/next-config-js/output
 */

// Bake the release version into the client bundle so the header can
// surface it without an extra round-trip. Reading package.json here
// (rather than relying on `process.env.npm_package_version`) keeps the
// value accurate when the app is launched outside of `npm run`, e.g.
// `node server.js` in the Docker standalone image.
const pkg = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version?: string };

const nextConfig: NextConfig = {
  output: process.env.BUILD_STANDALONE === '1' ? 'standalone' : undefined,
  env: {
    // `NEXT_PUBLIC_*` env values are inlined into the client bundle at
    // build time. Prefer an explicit override (CI can set this to a
    // tag/sha) and fall back to whatever is in package.json.
    NEXT_PUBLIC_APP_VERSION:
      process.env.NEXT_PUBLIC_APP_VERSION ?? pkg.version ?? '',
  },
};

export default nextConfig;
