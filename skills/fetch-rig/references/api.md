# API Reference

## `FetchConfig` (instance-level, `fr.create(config)`)

All fields optional.

| Field | Type | Notes |
|---|---|---|
| `baseUrl` | `string` | Prefix applied to relative `url` values |
| `headers` | `HeadersInit` | Merged with per-call headers (per-call wins) |
| `timeout` | `number` | ms, single timeout — overridable per call |
| `throwOnError` | `boolean \| ((status: number) => boolean)` | Default `false`. A function fully replaces the default non-2xx check — return `true` to throw for that status (not gated by `response.ok`, so it can throw for 2xx too) |
| `maxDownloadBytes` | `number` | Default unset (no limit) — overridable per call. See progress.md |
| `middlewares` | `FetchMiddleware[]` | No separate `retry` field — add `retry(options)` here. See middleware-retry.md |
| `redirect` | `RequestRedirect` | `'follow'` \| `'manual'` \| `'error'` — passed straight to `fetch()` |
| `credentials` | `RequestCredentials` | Passed straight to `fetch()` |
| `cache` | `RequestCache` | Passed straight to `fetch()` |
| `keepalive` | `boolean` | Passed straight to `fetch()` |

No proxy or XSRF-cookie options — out of scope by design (Node-only/browser-only conventions with no Fetch-spec equivalent).

## `RequestOptions` (per-call)

```typescript
interface RequestOptions {
  query?: Record<string, string | number | boolean | Array<string | number | boolean> | undefined>;
  headers?: HeadersInit;       // merged over instance headers, per-call wins
  signal?: AbortSignal;        // composed with the instance timeout via AbortSignal.any()
  timeout?: number;            // overrides the instance timeout for this call only
  throwOnError?: boolean | ((status: number) => boolean);  // overrides the instance default for this call only
  maxDownloadBytes?: number;   // overrides the instance default for this call only
  onUpload?: (event: ProgressInfo, chunk: Uint8Array) => void;
  onDownload?: (event: ProgressInfo, chunk: Uint8Array) => void;
}
```

`query` merges with any inline query string already on `url` (both survive). Array values serialize as repeated keys: `{ tag: ['a','b'] }` → `?tag=a&tag=b`.

## `FetchInstance`

```typescript
class FetchInstance {
  constructor(config?: FetchConfig);
  create(config?: FetchConfig): FetchInstance;

  get(url: string, options?: RequestOptions): Promise<FetchResponse>;
  head(url: string, options?: RequestOptions): Promise<FetchResponse>;
  options(url: string, options?: RequestOptions): Promise<FetchResponse>;
  delete(url: string, options?: RequestOptions): Promise<FetchResponse>;
  post(url: string, body?: unknown, options?: RequestOptions): Promise<FetchResponse>;
  put(url: string, body?: unknown, options?: RequestOptions): Promise<FetchResponse>;
  patch(url: string, body?: unknown, options?: RequestOptions): Promise<FetchResponse>;
  send(request: FetchRequest): Promise<FetchResponse>;
}
```

```typescript
type FetchRequest = { method: string; url: string; body?: unknown } & RequestOptions;
```

Note there is no generic on the request methods themselves (no `get<T>()`) — the generic lives on `FetchResponse.json<T>()` instead, so you always get the response object (status, headers) first, then choose how to parse the body.

## `FetchResponse`

```typescript
class FetchResponse {
  get ok(): boolean;
  get status(): number;
  get statusText(): string;
  get headers(): Headers;
  get url(): string;
  get redirected(): boolean;
  get type(): ResponseType;
  get body(): ReadableStream<Uint8Array> | null;
  get bodyUsed(): boolean;

  clone(): FetchResponse;
  text(): Promise<string>;
  json<T>(): Promise<T>;
  arrayBuffer(): Promise<ArrayBuffer>;
  blob(): Promise<Blob>;
  formData(): Promise<FormData>;
  bytes(): Promise<Uint8Array>;

  stream(options?: { format?: 'sse' | 'json' | 'text' | 'auto' }): AsyncGenerator<StreamResponse>;
  streamAsSse(): AsyncGenerator<SseStreamResponse>;
  streamAsJson(): AsyncGenerator<JsonStreamResponse>;
  streamAsText(): AsyncGenerator<TextStreamResponse>;
}
```

## Automatic Body Serialization

fetch-rig looks at both the body's type **and** any `Content-Type` already set — not the body type alone.

| Body | Existing Content-Type | Behavior |
|---|---|---|
| `Blob` | — | passed through, Content-Type from `blob.type` |
| `ArrayBuffer`/typed array | — | passed through, `application/octet-stream` |
| `URLSearchParams` | — | `.toString()`, `application/x-www-form-urlencoded;charset=UTF-8` |
| `FormData` | — | passed through; Content-Type is **never** set manually — the runtime generates the multipart boundary |
| `ReadableStream` | — | passed through as-is |
| plain object | `application/x-www-form-urlencoded` | URL-encoded |
| plain object | `multipart/form-data` | converted to `FormData` |
| plain object | anything else/unset | JSON-serialized, after confirming it's actually JSON-safe (`Map`/`Set`/custom class instances without `toJSON()` are rejected instead of silently becoming `"{}"`) |
| string/number/boolean | — | passed through as text |

Explicit `Content-Type` in `headers` always takes precedence over the default for a given body type (except `FormData`, which is never overridable — see the SKILL.md gotcha).

## Error Classes

```typescript
class FetchError extends Error {}  // base class, never thrown directly

class HTTPError extends FetchError {
  readonly response: Response;
  readonly request: Request;
  readonly data: unknown;  // pre-parsed body (JSON if valid, else raw text, else undefined) — read from a clone
  static async from(response: Response, request: Request): Promise<HTTPError>;
}

class NetworkError extends FetchError {
  readonly cause: unknown;  // fetch() itself rejected — DNS/connection failure, not a cancellation
}

class TimeoutError extends FetchError {
  readonly request: Request;  // the `timeout` option elapsed
}

class CanceledError extends FetchError {
  readonly reason: unknown;  // carried over from signal.reason verbatim
}

class TooLargeError extends FetchError {
  readonly maxDownloadBytes: number;
  readonly transferredBytes: number;  // how much had actually arrived when the limit was hit
}
```

`error instanceof CanceledError` is how you distinguish "the caller explicitly cancelled this" from every other failure mode — useful in a middleware's error handling, or deciding whether to show a retry UI.

## `FetchContext` and `FetchMiddleware` (for writing your own middleware)

See [middleware-retry.md](middleware-retry.md).

## `ProgressInfo`

```typescript
interface ProgressInfo {
  progress: number;          // 0–1; stays 0 until the stream completes if total can't be determined
  total: number;             // 0 if unknown (no Content-Length, or a ReadableStream body)
  loaded: number;
  rate?: number;              // bytes/sec, running average since the first chunk
  estimated?: number;         // seconds remaining, derived from rate
}
```

See [progress.md](progress.md) for the full behavior, including the Chrome/Firefox `onUpload`-never-fires caveat.
