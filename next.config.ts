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
const nextConfig: NextConfig = {
  output: process.env.BUILD_STANDALONE === '1' ? 'standalone' : undefined,
};

export default nextConfig;
