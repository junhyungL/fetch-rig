# Streaming Reference

`FetchResponse` exposes four async-generator stream methods, all built on `TransformStream`.

## Stream Types

### `response.stream(options)` — unified, format auto-detected

```typescript
for await (const item of response.stream({ format: 'auto' })) {
  item.type  // 'sse' | 'json' | 'text'
}
```

`format: 'auto'` (the default) picks a parser from the `Content-Type` response header:
- `text/event-stream` → SSE
- `application/json`, `application/x-ndjson`, or anything with a `+json` structured syntax suffix (`application/vnd.api+json`, `application/ld+json`, etc. — RFC 6839) → JSON object stream
- anything else → text (newline-delimited)

### `response.streamAsSse()` — Server-Sent Events

```typescript
for await (const event of response.streamAsSse()) {
  event.type   // always 'sse'
  event.event  // event name; default "message"
  event.data   // payload (multi-line data fields joined with '\n')
  event.id     // optional last-event-id
  event.retry  // optional reconnect hint (ms)
}
```

**Common pattern — LLM token streaming:**

```typescript
const res = await api.post("/chat", { messages });
for await (const e of res.streamAsSse()) {
  if (e.event === "delta") process.stdout.write(JSON.parse(e.data).token);
  if (e.event === "done") break; // breaking early still cancels the underlying connection — see below
}
```

### `response.streamAsJson()` — NDJSON / JSON Lines

Each yielded item carries one JSON value as a raw string — you decode it yourself.

```typescript
for await (const chunk of response.streamAsJson()) {
  chunk.type  // always 'json'
  chunk.data  // raw JSON string — call JSON.parse(chunk.data) to decode
  chunk.error // set instead of chunk.data being parseable, if this value failed JSON.parse
}
```

**NDJSON only.** A response that is a single top-level JSON array (`[{...},{...}]`) is emitted as *one* value once the entire array has arrived — it is not split into per-element items. If you're consuming an endpoint you don't control, verify it actually emits NDJSON (one value per line, or back-to-back independent values) before relying on incremental delivery here.

**A value that fails to parse is yielded, not thrown or silently dropped.** `chunk.error` is set (an `Error`) and `chunk.data` still holds the raw, unparseable text — check `chunk.error` before calling `JSON.parse(chunk.data)`:

```typescript
for await (const chunk of response.streamAsJson()) {
  if (chunk.error) {
    console.warn('skipped unparseable line:', chunk.data, chunk.error);
    continue;
  }
  const value = JSON.parse(chunk.data);
}
```

### `response.streamAsText()` — line-delimited text

```typescript
for await (const line of response.streamAsText()) {
  line.type  // always 'text'
  line.data  // one line, without the trailing newline
}
```

## Canceling a stream

Breaking out of a `for await` loop (`break`, `return`, or letting an error propagate uncaught) cancels the underlying stream, and — because every stage is a `TransformStream` piped together — that cancellation propagates all the way back through the pipeline to the original network connection, not just to the local parser. You don't need to call anything explicitly:

```typescript
const res = await api.get("/stream");
for await (const item of res.streamAsSse()) {
  if (shouldStop) break; // the connection is actually closed, not just abandoned locally
}
```

To cancel a stream from outside the loop (e.g. a user clicking "stop"), pass an `AbortSignal` to the originating request as usual:

```typescript
const controller = new AbortController();
const res = await api.get("/stream", { signal: controller.signal });
stopButton.onclick = () => controller.abort();
for await (const item of res.streamAsSse()) { }
```

## Type shapes

```typescript
type StreamResponse = SseStreamResponse | JsonStreamResponse | TextStreamResponse;

interface SseStreamResponse  { type: 'sse';  event: string; data: string; id?: string; retry?: number; }
interface JsonStreamResponse { type: 'json'; data: string; error?: Error; }
interface TextStreamResponse { type: 'text'; data: string; }
```
