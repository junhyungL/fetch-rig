# Changelog

## [0.1.1] - 2026-09-12

No runtime changes. Adds CI (GitHub Actions running lint, typecheck, tests, and build on every
push/PR) and an automated, tokenless release pipeline: pushing a `vX.Y.Z` tag now runs the full
verification suite, publishes to npm via OIDC trusted publishing, and creates a matching GitHub
Release with notes pulled from this changelog.

## [0.1.0] - 2026-09-10

Initial release. fetch-rig is a zero-dependency HTTP client built purely on the standard Fetch
API — requests, middleware (with built-in retry), upload/download progress, and streaming
(SSE / JSON Lines / text) — running identically in browsers, Node.js 20+, Deno, Bun, and
Cloudflare Workers.

See the [README](README.md) for usage and [docs/](docs/) for design details.
