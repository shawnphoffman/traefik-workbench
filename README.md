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

Releases are fully automated via [release-please](https://github.com/googleapis/release-please-action):

1. Every push to `main` runs `.github/workflows/release-please.yml`, which either opens or updates a single "Release PR" that bumps `package.json` and regenerates `CHANGELOG.md` based on the [Conventional Commits](https://www.conventionalcommits.org/) history.
2. The workflow enables GitHub auto-merge on that PR, so it lands on its own once CI passes.
3. When the PR merges, release-please tags `v<version>` and publishes a GitHub Release with the generated changelog.
4. The tag push triggers `.github/workflows/release.yml`, which builds and pushes the multi-arch image to `ghcr.io/<owner>/traefik-workbench:<version>`, `:<major>.<minor>`, and `:latest`.

Commit messages must follow Conventional Commits for this to work:

- `feat: …` → minor bump
- `fix: …` → patch bump
- `feat!: …` or `BREAKING CHANGE:` footer → (minor while `< 1.0.0`, major after)
- `docs: …`, `refactor: …`, `perf: …`, `revert: …` → patch bump, appear in the changelog
- `ci: …`, `build: …`, `test: …`, `chore: …`, `style: …` → hidden from the changelog, no bump

### One-time repo setup

Three knobs have to be flipped by hand because GitHub's security model won't let a workflow configure them on its own:

1. **Create a fine-grained Personal Access Token** scoped to this repository with these permissions:
   - `Contents`: Read and write
   - `Pull requests`: Read and write
   - `Workflows`: Read and write

   Store it as a repository secret named `RELEASE_PLEASE_TOKEN`. A PAT (or GitHub App token) is required because events triggered by the default `GITHUB_TOKEN` do not cascade into further workflow runs — without it, the Release PR's CI would never run and the tag push would never trigger the Docker publish.

2. **Enable "Allow auto-merge"** under `Settings → General → Pull Requests`. This is what lets the workflow call `gh pr merge --auto` on the Release PR.

3. **Protect `main` with required status checks.** GitHub will not let `gh pr merge --auto` arm a PR unless the target branch has a protection rule requiring at least one status check (or a review). Under `Settings → Branches → Add rule` for `main`, enable **Require status checks to pass before merging** and select these checks from `ci.yml`:
   - `Lint, type-check, unit tests`
   - `Playwright E2E`
   - `Docker image builds`

   Leave "Require a pull request before merging" off (the Release PR is the only thing that ever merges to `main` anyway, and requiring reviews would stall auto-merge).

Once those are in place the whole pipeline is hands-off: push `feat:` / `fix:` commits, and versions, changelogs, GitHub Releases, and Docker images flow out the other end on their own.

## License

[AGPL-3.0](./LICENSE)
