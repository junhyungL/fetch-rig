# Testing

## Approach

- Unit tests mirror `src/` under `tests/`, run with `vitest` (`environment: 'node'`).
- HTTP mocking via `msw` (Mock Service Worker) for most request/response scenarios.
- `tests/node-integration.test.ts` runs against a real `node:http` server instead of a mock —
  proof that cancellation reaches a real TCP connection (`req.on('aborted', ...)`, observed
  server-side), not just that an internal `AbortController` fired. It also re-verifies SSE
  streaming over a real socket and checks that no browser globals (`window`, `document`) are
  referenced anywhere.
- `@vitest/coverage-v8` measures statement/branch/function/line coverage. Target: 100% on all
  four — every reported gap gets investigated, never assumed safe to ignore.

## Coverage: 100%, two marked exceptions

Every flagged gap was checked individually. Most turned out to be real, previously-untested
scenarios:

- A `File`/`Blob` field in `FormData`'s size estimate
- Intermediate (not just final) progress when size is unknown
- The progress clamp engaging when `total` is underestimated
- A completely empty upload/download body
- An absolute URL with no path or query
- The `Retry-After` leap-second (`:60`) adjustment
- A stream ending mid-object (a truncated connection)
- `HTTPError.from()`'s cloned body failing to *read* (not just failing to parse)
- `uploadBytes` being omitted (valid per its own type)
- `supportsDuplex === false` in `normalizeRequest` — tested by mocking `duplex-support` in an
  isolated file and observing that `Request` throws on a streaming body without `duplex` (the
  only externally observable proof, since `Request` exposes no public `duplex` getter)

Two branches are genuinely unreachable given their own upstream guards — not just hard to
trigger — and are marked `/* v8 ignore next */` with an inline explanation instead of left as a
silent gap:

| File | Branch | Why unreachable |
| --- | --- | --- |
| `retry-after.ts` | `Number.isFinite(delay)` guard | `parseHttpDate()`/`createTimestamp()` already reject anything failing a round-trip validity check before a timestamp reaches this point |
| `JsonLineStream.ts` | `error instanceof Error` false branch | `JSON.parse` always throws a real `Error` (`SyntaxError`) per spec |

## Known tooling limitation: MSW doesn't propagate stream cancellation

MSW/undici's interception layer doesn't propagate `reader.cancel()` down to a mocked response
stream — calling `.cancel()` on a mocked response's body, even with zero fetch-rig code involved,
never resolves. Diagnosed with standalone probe scripts before concluding it's a tooling
limitation, not a fetch-rig bug. MSW-based tests for this behavior only assert what they can
control (the consuming loop stops where it broke); the real proof that cancellation reaches the
actual connection lives in `stream-iterator.test.ts` (pure Web Streams API, no MSW) and the real
`node:http` integration test above.

## Real-browser verification

`vitest`'s `environment: 'node'` can't surface runtime-specific Fetch behavior Node doesn't have.
Before release, fetch-rig was manually verified in real Chrome and Firefox with a throwaway dev
harness — a small `node:http` server plus a page running the same request/response/streaming/
progress scenarios the unit tests cover — not checked into the repository, since it served a
one-time purpose.

This surfaced a real, otherwise-undetectable gap: Chrome refuses to send a streamed
(`duplex: 'half'`) upload body over plain HTTP/1.1, failing before any byte is transmitted (see
[ARCHITECTURE.md](ARCHITECTURE.md#uploaddownload-progress)). Firefox doesn't support streaming
request bodies at all and silently sends the body unstreamed — confirmed by checking
`duplexSupported` (the same feature-detection trick `supportsDuplex` uses) alongside the
server-side received byte count, to be sure progress-less uploads still deliver the full body.

To re-verify browser behavior later (a new Fetch feature, a suspected runtime divergence): a
minimal `node:http` server with a few purpose-built endpoints (echo, controllable-failure,
slow/streaming), a page importing the built `dist/index.js` as a real ES module, and assertions
written to the page itself so results are readable by opening it — and check *why* a failure
happened (network panel, console errors), not just whether it passed.
