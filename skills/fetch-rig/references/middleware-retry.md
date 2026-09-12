# Middleware & Retry Reference

## Middleware model

```typescript
type Dispatch = (ctx: FetchContext) => Promise<void>;
type FetchMiddleware = (next: Dispatch) => Dispatch;

interface FetchContext {
  request: Request;
  response?: Response;        // set after a successful dispatch; undefined until then / on failure
  signal: AbortSignal;        // composed user signal + timeout, stable across retries
  config: FetchConfig;
  uploadBytes?: number;
  onUpload?: (event: ProgressInfo, chunk: Uint8Array) => void;
  onDownload?: (event: ProgressInfo, chunk: Uint8Array) => void;
  maxDownloadBytes?: number;   // resolved from the per-call option or the instance default
}
```

`next` is a **plain, repeatable function reference** — not a single-use callback. Call it once for a simple pass-through middleware, or multiple times for retry/re-authentication patterns. Middlewares registered via `middlewares: [a, b, c]` wrap in that order — `a` is outermost, so it runs first on the way in and last on the way out (onion order).

### Writing a middleware

```typescript
import type { FetchMiddleware } from "fetch-rig";

// Pass-through / logging — must await next()
const loggingMiddleware: FetchMiddleware = (next) => async (ctx) => {
  const start = Date.now();
  await next(ctx);
  console.log(ctx.request.method, ctx.request.url, ctx.response?.status, `${Date.now() - start}ms`);
};

// Short-circuit — never calls next() at all (e.g. a cache hit)
const cacheMiddleware: FetchMiddleware = (next) => async (ctx) => {
  const cached = cache.get(ctx.request.url);
  if (cached) {
    ctx.response = cached;
    return; // next() is NEVER called — downstream middleware/core dispatch is skipped entirely
  }
  await next(ctx);
  cache.set(ctx.request.url, ctx.response);
};

// Re-run downstream after a side effect (auth refresh) — calls next() twice
const authMiddleware: FetchMiddleware = (next) => async (ctx) => {
  ctx.request.headers.set("Authorization", `Bearer ${getToken()}`);
  await next(ctx);

  if (ctx.response?.status === 401) {
    await refreshToken();
    ctx.request = ctx.request.clone(); // REQUIRED — the first attempt already consumed the body/headers state
    ctx.request.headers.set("Authorization", `Bearer ${getToken()}`);
    await next(ctx);
  }
};
```

**Rules to follow:**
- Always `await next(ctx)` — a floating (un-awaited) call breaks ordering guarantees and is silently wrong; fetch-rig's own lint config enables `@typescript-eslint/no-floating-promises`/`require-await` specifically for this, and you should too in code that writes middleware.
- If you're going to call `next(ctx)` again after it already ran once, you **must** `ctx.request = ctx.request.clone()` first — the same `Request` object cannot be sent twice.
- Errors thrown by `fetch()` itself always reach your `catch` (if any) as a `FetchError` subclass (`CanceledError`/`NetworkError`/`TimeoutError`) — never a raw `DOMException` — so `error instanceof CanceledError` etc. is always reliable, at any layer of the stack.
- There is **no `retry` config field** — `retry` is always added explicitly to `middlewares`, at whatever position you choose. Put it outermost (first) to have retries re-run everything inside it (auth, logging); put it deeper in the array (e.g. inside an auth middleware) if you want token refresh to wrap the entire retry sequence instead.

```typescript
import { retry } from "fetch-rig";

const api = fr.create({
  middlewares: [retry({ limit: 3 }), authMiddleware, loggingMiddleware], // retry outermost
});

const api2 = fr.create({
  middlewares: [authMiddleware, retry({ limit: 3 }), loggingMiddleware], // retry inside auth
});
```

## `RetryOptions`

```typescript
interface RetryOptions {
  limit?: number;                 // default 2
  methods?: string[];             // default GET/HEAD/OPTIONS/PUT/DELETE/TRACE/QUERY — idempotent only
  statusCodes?: number[];         // default [408, 429, 500, 502, 503, 504]
  minTimeout?: number;            // default 300ms
  maxTimeout?: number;            // default Infinity
  factor?: number;                // default 2 (exponential backoff base)
  jitter?: boolean | ((delay: number) => number);  // default off; true = full jitter, or supply your own function
  shouldRetry?: (ctx: { error: unknown; attempt: number }) => boolean;  // overrides the default cancellation judgment
  onFailedAttempt?: (ctx: { attempt: number; response?: Response }) => void;
}
```

**POST is not retried by default** — it's not in the default `methods` list, because blindly retrying a non-idempotent request risks the server having already partially processed (or fully processed) the first attempt. Pass an explicit `methods` list including `'POST'` only if you're certain the endpoint is safe to retry (e.g. it's naturally idempotent, or uses an idempotency key).

**`CanceledError` is never retried by default**, even if the method/status would otherwise qualify — an explicit `signal.abort()` from the caller is respected as final. Pass `shouldRetry` to override this if you have a specific reason to retry after a cancellation.

`Retry-After` response headers are honored automatically (both delay-seconds and the three legacy HTTP-date formats: IMF-fixdate, RFC 850, asctime) — when the server specifies timing explicitly, jitter is skipped in favor of that deterministic value.

A streaming request body is cloned before each send attempt so retries actually resend the full content; the clone is skipped entirely once no more retries remain (avoids the memory cost of buffering a stream that will never be reused).
