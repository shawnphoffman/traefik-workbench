# traefik-workbench

A lightweight, self-hosted, web-based YAML editor with a 3-pane interface for managing Traefik configuration files without SSH.

## Features

- **Left pane:** file tree browser for the mounted data directory — create, rename, delete files and folders in place
- **Center pane:** Monaco editor with YAML syntax highlighting, multi-file tabs, dirty indicators, Cmd/Ctrl+S to save the active file, Cmd/Ctrl+W to close
- **Right pane:** live YAML structure outline — click any node to jump the editor to that line
- **Templates:** copy curated YAML snippets from a separate templates directory into your config
- **Unsaved-changes guard:** confirmation on close, plus a browser `beforeunload` prompt
- **Persistent layout:** collapse or resize either side pane; widths survive reloads
- **AI features (optional):** opt-in Claude-backed completion, validation, and format. Off by default; configured from a Settings page in the UI. See [AI features (optional)](#ai-features-optional) below.

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

By default the compose file pulls the published image from `ghcr.io/shawnphoffman/traefik-workbench:latest`. To build from source instead, uncomment the `build:` block in [`docker-compose.yml`](./docker-compose.yml).

### Environment variables

| Variable             | Default       | Description                                                                                              |
| -------------------- | ------------- | -------------------------------------------------------------------------------------------------------- |
| `DATA_DIR`           | `/data`       | Absolute path (inside the container) to the directory of YAML files the workbench can read and write.   |
| `TEMPLATES_DIR`      | `/templates`  | Absolute path (inside the container) to a directory of template YAML snippets to copy into `DATA_DIR`.  |
| `TEMPLATES_READONLY` | `true`        | Set to `false` to allow writes to `TEMPLATES_DIR`. Defaults to read-only.                                |
| `CONFIG_DIR`         | `/config`     | Absolute path (inside the container) where the workbench persists its settings file (`settings.json`).  |
| `ANTHROPIC_API_KEY`  | _(unset)_     | Optional fallback for the Claude API key. Used only when no key is set from the Settings page. Docker-secret friendly. |
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

## AI features (optional)

Traefik configs are exactly the kind of document where structural validation and cross-file awareness pay off — for example, "this `service:` references a service that doesn't exist in any other file". The workbench has an opt-in layer that uses [Claude](https://www.anthropic.com/claude) for that.

**It is off by default.** When disabled, no `/api/ai/*` requests are made, the editor behaves identically to a vanilla workbench, and the Anthropic SDK is never invoked.

### What you get when it's on

- **Completion** — Traefik-aware suggestions on Ctrl+Space and on `:` / `-` / space triggers, scoped to the active file's type (static or dynamic).
- **Validation** — Claude scans the active file in the context of its workspace siblings and pushes diagnostics into Monaco's gutter.
- **Format** — `Cmd/Ctrl+Shift+F` reformats the active file. The result is rejected if it changes any semantic content (the parsed YAML must round-trip identically), so Claude can never silently rewrite a value.

A small status pill in the editor footer shows what the AI subsystem is doing (idle / thinking / clean / error).

### Enabling it

1. Click the gear icon in the header to open the **Settings** page.
2. Paste your Anthropic API key (`sk-ant-...`) into the **Anthropic API key** field.
3. Pick a model (Haiku / Sonnet / Opus) and toggle the features you want.
4. Click **Test connection** to verify the key works.
5. Flip the **Enable AI features** master switch on.

The Settings page also exposes a **Recent AI activity** panel — the last 100 calls with timing and status — so you can see exactly what Claude is being asked to do. The buffer is in-memory and clears on restart.

### Where the key lives

Settings are persisted to `${CONFIG_DIR}/settings.json` (default `/config` inside the container). The file is written via the same atomic-rename helper used elsewhere and `chmod 0600`'d so only the workbench user can read it.

> **Trust model:** the API key is stored in plaintext on the config volume. Treat that volume as a secret — back it up the same way you'd back up a `.env` file with credentials in it. The key never reaches the browser; the masked version (`sk-ant-•••••XXXX`) is the only thing the UI ever sees.

If you'd rather inject the key via a Docker secret or env var, set `ANTHROPIC_API_KEY` on the container. The Settings page will detect it, show a "from env" badge, and disable the input. Any key set via the Settings page takes precedence over the env var.

### How tightly Claude is sandboxed

Every Claude call is locked down at four layers, on purpose:

1. **Forced tool use.** Each `/api/ai/*` route passes a single hand-rolled JSON Schema tool to the SDK with `tool_choice: { type: 'tool', name: ... }`. There is no path for Claude to return free-form text or invoke any other tool.
2. **Locked system prompts.** Prompts are static constants (never templated from user input) and end with explicit boundary statements about which tool to call and what not to do.
3. **Schema re-validation on the way out.** Every tool response is re-validated against the same schema on the server before being returned to the client. Anything that doesn't match becomes a 502.
4. **Per-feature semantic invariants.** Completion items that would de-indent past the cursor are dropped. Out-of-range diagnostics are dropped. Format responses are diffed against the input via parsed YAML — any semantic change rejects the entire response with a 422.

If Claude misbehaves or the network is down, the editor keeps working — the status pill just turns red and the affected feature returns nothing.

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
