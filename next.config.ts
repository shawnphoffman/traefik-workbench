import type { NextConfig } from 'next';

/**
 * `output: 'standalone'` produces a minimal self-contained server
 * under `.next/standalone/` that the Docker runtime stage copies in
 * place of the full `node_modules`. See:
 * https://nextjs.org/docs/app/api-reference/config/next-config-js/output
 */
const nextConfig: NextConfig = {
  output: 'standalone',
};

export default nextConfig;
