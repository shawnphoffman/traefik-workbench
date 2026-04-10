# traefik-workbench

A lightweight, self-hosted, web-based YAML editor with a 3-pane interface for managing Traefik configuration files without SSH.

> **Status:** early development — foundation only. See the project plan for the full feature roadmap.

## Planned Features

- **Left pane:** file tree browser for a mounted directory
- **Center pane:** Monaco editor with YAML syntax support and tabs for multiple files
- **Right pane:** parsed YAML structure tree (click to navigate the editor)
- **Templates:** curated "golden" YAML files that can be copied when creating new files
- Docker-deployable, configurable via environment variables

## Tech Stack

- Next.js 16 (App Router) + TypeScript (strict)
- Tailwind CSS v4
- Monaco Editor (`@monaco-editor/react`)
- `yaml` (preserves comments and formatting)
- `react-arborist` (file tree)
- Vitest + React Testing Library (unit/component tests)
- Playwright (E2E)

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

Configuration is read from environment variables — see [`.env.example`](./.env.example).

## License

[AGPL-3.0](./LICENSE)
