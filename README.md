# fetch-rig

A zero-dependency HTTP client built on the standard Fetch API. Works identically in browsers,
Node.js 20+, Deno, Bun, and Cloudflare Workers — no XMLHttpRequest, no DOM, no runtime-specific
code paths.

```bash
npm install fetch-rig
```

## Quick start

```typescript
import { fr } from "fetch-rig";

// Use the default instance directly
const res = await fr.get("https://api.example.com/users");
const users = await res.json();

// Or create a scoped instance
const api = fr.create({
  baseUrl: "https://api.example.com",
  headers: { Authorization: "Bearer token" },
  timeout: 5_000,
});

await api.post("/messages", { text: "Hello" });
```

`fr` isn't a special namespace — it's a `FetchInstance` created with no config. `fr.create(config)`
returns a new instance; `fr.get(...)` calls the default instance directly.

## Requests

```typescript
api.get(url, options?)
api.head(url, options?)
api.options(url, options?)
api.delete(url, options?)
api.post(url, body?, options?)
api.put(url, body?, options?)
api.patch(url, body?, options?)
api.send({ method, url, body, ...options })
```

Every method resolves to `Promise<FetchResponse>` — a thin `Response` wrapper with
`.ok`/`.status`/`.headers`, `.text()`/`.json<T>()`/`.arrayBuffer()`/`.bytes()`/`.blob()`/
`.formData()`/`.clone()`, and streaming methods. A request body is auto-serialized from its type
and any `Content-Type` you've already set (`FormData` passed through untouched, a plain object
JSON-encoded by default, etc.) — see [ARCHITECTURE.md](docs/ARCHITECTURE.md#automatic-request-body-serialization)
for the full table.

## Cancellation & timeout

Standard `AbortController` — no custom cancel token:

```typescript
const controller = new AbortController();
setTimeout(() => controller.abort(), 2000);
await api.get("/slow", { signal: controller.signal });
```

A single `timeout` option (ms) is available at both the instance and per-call level.

## Middleware & retry

Middleware wraps `next`, a plain function callable as many times as needed — not a Koa-style
single-use callback — which is what makes retry and auth-refresh simple to express:

```typescript
import { fr, retry } from "fetch-rig";
import type { FetchMiddleware } from "fetch-rig";

const authMiddleware: FetchMiddleware = (next) => async (ctx) => {
  ctx.request.headers.set("Authorization", `Bearer ${getToken()}`);
  await next(ctx);
  if (ctx.response?.status === 401) {
    await refreshToken();
    ctx.request = ctx.request.clone(); // already sent once — clone before reusing
    ctx.request.headers.set("Authorization", `Bearer ${getToken()}`);
    await next(ctx);
  }
};

const api = fr.create({
  middlewares: [authMiddleware, retry({ limit: 2, jitter: true })],
});
```

Retry is itself a middleware, not a config option — add `retry(options)` to `middlewares`
wherever you want it in the stack; where you place it changes what re-runs on each attempt. It
honors a server's `Retry-After` header and never retries a `CanceledError` (an explicit
cancellation) by default. Full options in
[ARCHITECTURE.md](docs/ARCHITECTURE.md#built-in-retry).

## Upload / download progress

A per-call option, not a middleware — scoped to the one request that needs it:

```typescript
await api.post("/upload", file, {
  onUpload: (event) => console.log(`${(event.progress * 100).toFixed(0)}% (${event.rate ?? 0} B/s)`),
});

const res = await api.get("/large-file", {
  onDownload: (event) => console.log(`${event.loaded} bytes, ~${event.estimated ?? "?"}s left`),
});
```

Also caps response size: `fr.create({ maxDownloadBytes: 10 * 1024 * 1024 })` throws
`TooLargeError` once real received bytes exceed the limit. Details, including a real browser
gotcha with streamed uploads, in [ARCHITECTURE.md](docs/ARCHITECTURE.md#uploaddownload-progress).

## Streaming responses

```typescript
const res = await api.get("/stream");

for await (const item of res.stream()) { /* Content-Type-based auto-detection */ }

for await (const event of res.streamAsSse()) {
  console.log(event.event, event.data, event.id, event.retry);
}
for await (const line of res.streamAsJson()) {
  if (line.error) continue; // failed to parse — raw text still in line.data
  console.log(JSON.parse(line.data));
}
for await (const line of res.streamAsText()) {
  console.log(line.data);
}
```

Breaking out of the loop early cancels the underlying connection, not just the local parser.
`streamAsJson()` is NDJSON-only — see [ARCHITECTURE.md](docs/ARCHITECTURE.md#json-lines-stream).

## Errors

```typescript
import { HTTPError, NetworkError, TimeoutError, CanceledError, TooLargeError } from "fetch-rig";

try {
  await api.get("/might-fail", { throwOnError: true });
} catch (error) {
  if (error instanceof HTTPError) console.error(error.response.status, error.data);
  else if (error instanceof TimeoutError) console.error("timed out");
  else if (error instanceof CanceledError) console.error("cancelled:", error.reason);
  else if (error instanceof TooLargeError) console.error(`too large: ${error.transferredBytes}`);
  else if (error instanceof NetworkError) console.error("network failure:", error.cause);
}
```

`throwOnError` defaults to `false` — a non-2xx response resolves normally (`response.ok === false`)
unless you opt in. Coming from raw `fetch()` code that checks `error.name === "AbortError"`? Use
`error instanceof CanceledError` instead — it also distinguishes a cancellation from a
`TimeoutError`, which a bare name check can't. Full error model in
[ARCHITECTURE.md](docs/ARCHITECTURE.md#error-model).

## Documentation

- [docs/CONCEPT.md](docs/CONCEPT.md) — what fetch-rig is and the design principles behind it
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — how the request pipeline, middleware, and streaming are implemented
- [docs/TESTING.md](docs/TESTING.md) — test strategy and coverage approach

## License

MIT
