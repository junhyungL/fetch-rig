# Upload / Download Progress Reference

Progress is a **per-call option**, not a middleware — pass it directly to the request that needs it:

```typescript
await api.post("/upload", file, {
  onUpload: (event, chunk) => console.log(`${(event.progress * 100).toFixed(0)}%`),
});

const res = await api.get("/large-file", {
  onDownload: (event, chunk) => console.log(`${event.loaded} bytes`),
});
```

```typescript
interface ProgressInfo {
  progress: number;          // 0–1
  total: number;              // 0 if unknown
  loaded: number;
  rate?: number;              // bytes/sec, running average since the first chunk — undefined until measurable
  estimated?: number;         // seconds remaining, derived from rate — undefined if rate or total is unknown
}
```

The callback parameter is conventionally named `event`, not `progress` — `event.progress` (the field) would otherwise stutter against a parameter also named `progress`.

`rate`/`estimated` are a **simple running average**, not a smoothed/recent-window estimate (unlike axios's `Speedometer`) — they react slowly if transfer speed suddenly changes mid-request. Both are absent on a zero-byte body and on the very first reported event (no elapsed time to measure yet); `estimated` is additionally absent whenever `total` is 0/unknown.

## `progress` and `total` can both be 0

`total` is 0 whenever it can't be determined ahead of time:
- **Download**: no `Content-Length` response header.
- **Upload**: a `ReadableStream` body (its size genuinely can't be known upfront — `File`/`Blob`/`FormData`/string/`ArrayBuffer` bodies *can* be sized ahead of time and will have a real `total`).

When `total` is 0, `progress` stays exactly `0` for every intermediate event — it does **not** estimate or guess — but `loaded` still updates normally, and the very last event (once the stream actually finishes) reports `progress: 1`. If you're building a progress bar, treat a `total` of 0 as "show an indeterminate spinner using `loaded`," not as "0% forever."

## Progress never double-counts across a retry

If `retry` is configured and a request is retried, each attempt gets independent progress tracking — the spare request clone held for a possible next retry is never wrapped with a progress tracker, only the request actually being sent this attempt is. You won't see progress "restart from a wrong number" or accumulate across attempts.

## Critical gotcha: `onUpload` can legitimately never fire, even on success

Sending `onUpload` streams the request body (`duplex: 'half'`), and **not every runtime can actually do that**:

- **Chrome** only allows a streamed request body over an HTTP/2 connection (browsers only negotiate HTTP/2 via TLS/ALPN) — POSTing to a plain HTTP/1.1 origin (common for local dev servers) means the streamed attempt fails before a single byte leaves the client.
- **Firefox** (at least as tested) doesn't support streaming request bodies at all.

fetch-rig handles both cases the same way: **the upload still completes successfully**, but `onUpload` is never called. On Chrome specifically, this is because fetch-rig detects the "failed before anything was sent" case and transparently retries once without streaming, rather than surfacing a confusing network error just because progress was requested. On Firefox, the runtime itself just sends the body unstreamed from the start.

**What this means for your code:**
- Do **not** use "did `onUpload` fire at least once" as a signal that the upload is happening or succeeded — check `await api.post(...)` resolving normally instead.
- Do **not** assume a progress bar driven purely by `onUpload` will always move — design for the case where it silently never updates and the request just completes.
- A failure that happens **after** the upload has genuinely started streaming (i.e. after real progress has already been reported) is a real network error and *is* surfaced normally as a `NetworkError` — it is not silently retried, because the server may have already received part of the body.
- Production HTTPS APIs behind a modern load balancer/CDN almost always speak HTTP/2 and are unaffected — this mainly matters for local HTTP-only development backends, or unusually old/non-standard servers.

## Capping response size: `maxDownloadBytes`

```typescript
const api = fr.create({ baseUrl: "...", maxDownloadBytes: 10 * 1024 * 1024 }); // instance default
await api.get("/report", { maxDownloadBytes: 1024 * 1024 });                   // per-call override
```

Settable on both `FetchConfig` (instance-wide default) and `RequestOptions` (per-call, overrides the instance value). No limit by default. Once the response body's real received bytes exceed the limit, the stream errors with `TooLargeError` (`error.maxDownloadBytes`, `error.transferredBytes`) — checked against actual bytes as they arrive, **not** the `Content-Length` header (which can be absent, or simply wrong).

**Gotcha, same shape as the upload one**: `await api.get(url, { maxDownloadBytes })` itself does not reject when the body turns out to be too large — `fetch()` resolves as soon as headers arrive, before the body is read. The error only surfaces when you actually consume the body:

```typescript
const response = await api.get("/maybe-huge", { maxDownloadBytes: 1_000_000 }); // resolves fine
try {
  const text = await response.text(); // THIS is where TooLargeError can throw
} catch (error) {
  if (error instanceof TooLargeError) { /* ... */ }
}
```
