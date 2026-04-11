# traefik-workbench

A lightweight, self-hosted, web-based YAML editor with a 3-pane interface for managing Traefik configuration files without SSH.

## Features

- **Left pane:** file tree browser for the mounted data directory — create, rename, delete files and folders in place
- **Center pane:** Monaco editor with YAML syntax highlighting, multi-file tabs, dirty indicators, Cmd/Ctrl+S to save, Cmd/Ctrl+Shift+S to save all, Cmd/Ctrl+W to close
- **Right pane:** live YAML structure outline — click any node to jump the editor to that line
- **Templates:** copy curated YAML snippets from a separate templates directory into your config
- **Unsaved-changes guard:** confirmation on close, plus a browser `beforeunload` prompt
- **Persistent layout:** collapse or resize either side pane; widths survive reloads

## Tech Stack

- Next.js 16 (App Router) + TypeScript (strict)
- Tailwind CSS v4
- Monaco Editor (`@monaco-editor/react`)
- `yaml` (preserves comments and formatting)
- `react-arborist` (file tree)
- Vitest + React Testing Library (unit/component tests)
- Playwright (E2E)

## Quick Start (Docker)

The fastest way to run traefik-workbench against an existing Traefik config directory:

```bash
# 1. Point the compose file at your host's Traefik dynamic config dir.
export DATA_DIR_HOST=/etc/traefik/dynamic

# 2. (Optional) Point at a templates directory.
export TEMPLATES_DIR_HOST=./templates

# 3. Start it.
docker compose up -d
```

Then open <http://localhost:3000>.

By default the compose file pulls the published image from `ghcr.io/shoffman/traefik-workbench:latest`. To build from source instead, uncomment the `build:` block in [`docker-compose.yml`](./docker-compose.yml).

### Environment variables

| Variable             | Default       | Description                                                                                              |
| -------------------- | ------------- | -------------------------------------------------------------------------------------------------------- |
| `DATA_DIR`           | `/data`       | Absolute path (inside the container) to the directory of YAML files the workbench can read and write.   |
| `TEMPLATES_DIR`      | `/templates`  | Absolute path (inside the container) to a directory of template YAML snippets to copy into `DATA_DIR`.  |
| `TEMPLATES_READONLY` | `true`        | Set to `false` to allow writes to `TEMPLATES_DIR`. Defaults to read-only.                                |
| `PORT`               | `3000`        | Port the Next.js server listens on inside the container.                                                 |
| `HOSTNAME`           | `0.0.0.0`     | Bind address. Leave as-is for container deployments.                                                     |

All paths are sanitized against `DATA_DIR` / `TEMPLATES_DIR` before any filesystem call — user input cannot escape the configured roots.

### Running behind Traefik

The included `docker-compose.yml` has a commented-out block of Traefik router labels. Uncomment and adjust the hostname and cert resolver, then attach the container to the same docker network as your Traefik instance:

```yaml
    networks:
      - traefik-public
    labels:
      traefik.enable: "true"
      traefik.docker.network: "traefik-public"
      traefik.http.routers.workbench.rule: "Host(`workbench.example.com`)"
      traefik.http.routers.workbench.entrypoints: "websecure"
      traefik.http.routers.workbench.tls.certresolver: "letsencrypt"
      traefik.http.services.workbench.loadbalancer.server.port: "3000"

networks:
  traefik-public:
    external: true
```

> **Security note:** traefik-workbench has no built-in authentication. Always put it behind an authenticating proxy (Traefik's [BasicAuth middleware](https://doc.traefik.io/traefik/middlewares/http/basicauth/), [forward-auth](https://doc.traefik.io/traefik/middlewares/http/forwardauth/), or an OIDC gateway) before exposing it to the public internet.

### Building the image manually

```bash
docker build -t traefik-workbench .
docker run -d \
  -p 3000:3000 \
  -v /etc/traefik/dynamic:/data \
  -v "$PWD/templates:/templates:ro" \
  --name traefik-workbench \
  traefik-workbench
```

The image is a multi-stage build that uses Next.js's `output: 'standalone'` mode, runs as an unprivileged `nextjs` user (uid `1001`), and exposes a healthcheck on `/`.

## Development

```bash
npm install
npm run dev          # http://localhost:3000
npm run test         # unit tests
npm run test:watch   # unit tests in watch mode
npm run test:e2e     # end-to-end tests (requires `npm run build` first)
npm run lint
npm run type-check
```

For local development, copy [`.env.example`](./.env.example) to `.env.local` and point `DATA_DIR` / `TEMPLATES_DIR` at a scratch directory. A `.local-dev/` folder is gitignored and ready to use.

## Releases

Every push to `main` publishes a fresh multi-arch image to GHCR. There is no version bump, release PR, or GitHub Release ceremony — `.github/workflows/release.yml` builds for `linux/amd64` + `linux/arm64` and pushes these tags:

- `ghcr.io/<owner>/traefik-workbench:latest` — rolling tip of `main`
- `ghcr.io/<owner>/traefik-workbench:main` — alternate alias for the same target
- `ghcr.io/<owner>/traefik-workbench:sha-<short>` — immutable pin for an exact commit (use this in production if you want reproducible deploys)

If a runner hangs or the registry hiccups, re-run the workflow from the Actions tab — `release.yml` also exposes a `workflow_dispatch` trigger that rebuilds and republishes the current `main`.

`CHANGELOG.md` is a historical artifact from an earlier release-please experiment and is no longer maintained automatically.

## License

[AGPL-3.0](./LICENSE)
