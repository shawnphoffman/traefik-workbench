# Changelog

## [0.3.0](https://github.com/shawnphoffman/traefik-workbench/compare/v0.2.2...v0.3.0) (2026-04-15)


### Features

* **ai:** optional Claude-powered completion, validation, and format ([b87b720](https://github.com/shawnphoffman/traefik-workbench/commit/b87b72012a5077bca2aa6ba8a6ac3131a394d9fe))
* **brand:** rebrand to Træfik Workbench and adopt Traefik mark ([e9ef1ea](https://github.com/shawnphoffman/traefik-workbench/commit/e9ef1ea78421ed6aeab292f61a77f4c79e7e86b8))
* **brand:** use logo across UI and flesh out page metadata ([13c648d](https://github.com/shawnphoffman/traefik-workbench/commit/13c648d013a01784f7bdd9502740e81ca9978fea))
* **editor:** individual save button and per-file save state ([d959e8c](https://github.com/shawnphoffman/traefik-workbench/commit/d959e8c80d37f988874ed0fb932f8eea9896c9a1))
* **editor:** live AI toggle and session persistence ([3218fb5](https://github.com/shawnphoffman/traefik-workbench/commit/3218fb59c59d589ae2411dc72dd36299ab162805))
* **editor:** remove Save all action and Cmd+Shift+S shortcut ([2986d68](https://github.com/shawnphoffman/traefik-workbench/commit/2986d68305a7fdb1230b0f90774f9ea9a8b05b4a))
* **editor:** use Cmd/Ctrl+Shift+W to close the active tab ([e305ba9](https://github.com/shawnphoffman/traefik-workbench/commit/e305ba99a462be57ac281aabeb99af198917ceee))
* **release:** version pill in header, driven by release-please ([44af9b1](https://github.com/shawnphoffman/traefik-workbench/commit/44af9b1485664d0681f1e485048bc626e70607ef))
* **settings:** user-configurable file tree ignore patterns ([519d7ff](https://github.com/shawnphoffman/traefik-workbench/commit/519d7ff8e8de0c1705a4ab07b0f74822488d024c))
* **templates:** editable templates pane in a split left panel ([e3434ce](https://github.com/shawnphoffman/traefik-workbench/commit/e3434ce870970e9656095948f22f4e275ff53876))
* **traefik:** local diagnostics and AI review ([20fdd60](https://github.com/shawnphoffman/traefik-workbench/commit/20fdd6043794c14a0cb7b36d6048443192ef2c09))
* **traefik:** read-only Traefik API integration page ([d09b06b](https://github.com/shawnphoffman/traefik-workbench/commit/d09b06b2586780ca188701c2aec8a6302630fc5f))
* **tree:** disable non-YAML files in the file tree ([40775b5](https://github.com/shawnphoffman/traefik-workbench/commit/40775b5f1803cad97e2c8800a7da270814a0b443))
* **tree:** move files, save as template, and small-screen layout ([bcdce5d](https://github.com/shawnphoffman/traefik-workbench/commit/bcdce5dc371d4ccb84325ed70a77cf578fec28f1))


### Bug Fixes

* **docs:** correct GHCR image owner from shoffman to shawnphoffman ([d985342](https://github.com/shawnphoffman/traefik-workbench/commit/d98534258afa770c9153b27f36935103a2bb0fcc))
* **editor:** keep status-bar pills from wrapping mid-label ([d5baf7e](https://github.com/shawnphoffman/traefik-workbench/commit/d5baf7e3b06f0a266f042d3fe034fc2a78aa4613))
* **settings:** format Claude API test errors nicely ([b40ec40](https://github.com/shawnphoffman/traefik-workbench/commit/b40ec40b790aa50aeb2009442652599e12bdce42))


### Documentation

* **readme:** add logo, AI disclosure, and screenshots ([8344b59](https://github.com/shawnphoffman/traefik-workbench/commit/8344b5950ed0d1cff31064d5156b1233ae392fd5))
* **screenshots:** refresh editor and settings captures ([66df9b7](https://github.com/shawnphoffman/traefik-workbench/commit/66df9b773b6b2f431f2c92362ac015b4a8f5e03f))

## [0.2.2](https://github.com/shawnphoffman/traefik-workbench/compare/v0.2.1...v0.2.2) (2026-04-11)


### Bug Fixes

* **ci:** switch release-please to simple release-type to fix component mismatch ([d8ff70f](https://github.com/shawnphoffman/traefik-workbench/commit/d8ff70f47b01815e4b47dbf8d350fc00db2f08d1))

## [0.2.1](https://github.com/shawnphoffman/traefik-workbench/compare/v0.2.0...v0.2.1) (2026-04-11)


### Bug Fixes

* **ci:** drop package-name so release-please can match merged release PRs ([17b5d9f](https://github.com/shawnphoffman/traefik-workbench/commit/17b5d9faaa86e45dceb6278f8c579154105dc02b))

## [0.2.0](https://github.com/shawnphoffman/traefik-workbench/compare/v0.1.0...v0.2.0) (2026-04-11)


### Features

* **deploy:** Dockerfile, docker-compose, and deployment docs ([944c5d1](https://github.com/shawnphoffman/traefik-workbench/commit/944c5d1531135645c7f3413c0869916e9017bd65))
* **editor:** guard unsaved changes on tab close and page unload ([a328bbb](https://github.com/shawnphoffman/traefik-workbench/commit/a328bbbdfee98d754075ba41bb6c98178891ef57))
* **files:** rename file or folder via PATCH /api/files ([e46ae4e](https://github.com/shawnphoffman/traefik-workbench/commit/e46ae4ef5655100ce6c68f9f3470180cb62c52e2))
* **layout:** collapsible and resizable side panes ([9e8b09f](https://github.com/shawnphoffman/traefik-workbench/commit/9e8b09f0499e9fe188e31fbfdb7f6cbf600fcdae))
* **ui:** app header and lucide icon sweep ([1a4132a](https://github.com/shawnphoffman/traefik-workbench/commit/1a4132abd8ecba4645e4f86d39fea97bda22e192))
* **ui:** hover tooltips on all action buttons ([9f274cb](https://github.com/shawnphoffman/traefik-workbench/commit/9f274cb409caf5705ac789f13065e6b333028120))
* **ui:** status bar icons, loading spinners, danger dialog badge ([9d9bfc9](https://github.com/shawnphoffman/traefik-workbench/commit/9d9bfc96caaf6c8518c082d2344a57f3a8adf4c6))


### Bug Fixes

* **ui:** center modal dialogs and pad file tree rows ([47e5753](https://github.com/shawnphoffman/traefik-workbench/commit/47e57532e8c55df2125d8c1e219bc952300daf57))


### Documentation

* require branch protection for release-please auto-merge ([8fd3536](https://github.com/shawnphoffman/traefik-workbench/commit/8fd3536d397de51c5e85a41555d55b0a9d28738d))
