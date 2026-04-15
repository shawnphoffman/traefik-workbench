# syntax=docker/dockerfile:1.7

# ---------- deps ----------
# Install production + build dependencies in a separate stage so the
# final image doesn't carry npm's cache or devDependencies.
FROM node:22-alpine AS deps
WORKDIR /app

# libc6-compat is needed by some Node native modules on Alpine.
RUN apk add --no-cache libc6-compat

COPY package.json package-lock.json ./
RUN npm ci

# ---------- builder ----------
# Run `next build` against the full source tree. With
# `output: 'standalone'` in next.config.ts, this produces
# `.next/standalone/` containing a minimal `server.js` plus only the
# node_modules files the app actually imports.
FROM node:22-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build-time env. NEXT_TELEMETRY_DISABLED keeps builds silent in CI,
# and BUILD_STANDALONE=1 flips on `output: 'standalone'` so the
# runtime stage has a self-contained server to copy.
ENV NEXT_TELEMETRY_DISABLED=1
ENV BUILD_STANDALONE=1

# Release version baked into the client bundle. CI sets this to the
# semver on release commits and `<semver>-main.<sha>` on intermediate
# builds; local/unset builds fall back to package.json via the
# next.config.ts default. Declared as an ARG → ENV pair so
# `process.env.NEXT_PUBLIC_APP_VERSION` is visible to `next build`.
ARG NEXT_PUBLIC_APP_VERSION=""
ENV NEXT_PUBLIC_APP_VERSION=$NEXT_PUBLIC_APP_VERSION

RUN npm run build

# ---------- runner ----------
# Minimal runtime image. We copy only the standalone server, the
# static assets, and the public directory — no source code, no
# devDependencies, no package-lock.
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Data locations inside the container. Override via docker run -e or
# the docker-compose file. These MUST be bind-mounted from the host.
ENV DATA_DIR=/data
ENV TEMPLATES_DIR=/templates

# Create an unprivileged user so the server doesn't run as root.
# Matches the 1001:1001 convention used by the official Next.js
# example so host bind-mounts can chown accordingly.
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

# Copy the standalone server and its trimmed node_modules.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
# Static assets and public files are not copied into standalone
# automatically; they need to be placed in the expected paths.
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Create empty mount points so the image works out of the box with
# anonymous volumes, and so the non-root user can write into /data.
RUN mkdir -p /data /templates \
 && chown -R nextjs:nodejs /data /templates

USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:3000/ || exit 1

CMD ["node", "server.js"]
