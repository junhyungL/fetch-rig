# Contributing

## Setup

```bash
git clone https://github.com/junhyungL/fetch-rig.git
cd fetch-rig
npm ci
```

Requires Node.js 20+.

## Before opening a PR

Run all of these locally — the same checks run in CI against Node 20/22/24, and a PR can't be
merged until they pass:

```bash
npm run lint
npm run typecheck
npm run test:coverage
npm run build
```

- **Coverage stays at 100%** (statements/branches/functions/lines) — see
  [docs/TESTING.md](docs/TESTING.md) for how existing gaps were handled. A change that drops
  coverage needs a test, not a suppressed check.
- If you change request/response/middleware/streaming behavior, update the relevant section of
  [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and, if it's user-facing, the
  [README](README.md) and [skills/fetch-rig](skills/fetch-rig/SKILL.md) too.
- Keep the zero-dependency, universal-runtime constraint in mind — no Node-only or
  browser-only APIs in `src/` (see [docs/CONCEPT.md](docs/CONCEPT.md)).

## Opening a PR

Describe what changed and why. Link any related issue. CI must pass on all three Node versions
before merge.

## Releasing (maintainers)

Bump `version` in `package.json`, add a matching `## [x.y.z]` entry to `CHANGELOG.md`, commit,
then `git tag vX.Y.Z && git push origin vX.Y.Z`. The tag push runs the full check suite,
publishes to npm, and creates a GitHub Release from the changelog entry — no manual npm login or
OTP required.
