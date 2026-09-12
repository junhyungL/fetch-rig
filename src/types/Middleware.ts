import type { FetchConfig } from './FetchConfig';
import type { ProgressInfo } from './ProgressInfo';

/** Mutable state threaded through the middleware chain for a single request. */
export interface FetchContext {
  request: Request;
  response?: Response;
  /** The user's signal + timeout signal composed via AbortSignal.any() — stays the same across every retry attempt. */
  signal: AbortSignal;
  config: FetchConfig;
  /** Byte size of the serialized request body (for upload progress) — 0 if it can't be known ahead of time for a stream body. Stays the same across retries. */
  uploadBytes?: number;
  /** Per-call option — the base dispatch applies this only to the request/response actually being sent this attempt. */
  onUpload?: (event: ProgressInfo, chunk: Uint8Array) => void;
  onDownload?: (event: ProgressInfo, chunk: Uint8Array) => void;
  /** Resolved from the per-call option or the instance default — see `FetchConfig.maxDownloadBytes`. */
  maxDownloadBytes?: number;
}

/** Runs a request and fills in `ctx.response` (or throws). The innermost link in the chain. */
export type Dispatch = (ctx: FetchContext) => Promise<void>;

/**
 * A function-wrapping middleware, in the same family as undici's `Dispatcher.compose()` and
 * Redux middleware — not Koa's single-use `next()` callback. `next` is a plain function
 * reference and may be called any number of times, which is what lets `retry` loop and an
 * auth-refresh middleware call it again after a 401.
 *
 * @example
 * ```ts
 * const logger: FetchMiddleware = (next) => async (ctx) => {
 *   await next(ctx);
 *   console.log(ctx.request.method, ctx.request.url, ctx.response?.status);
 * };
 * ```
 */
export type FetchMiddleware = (next: Dispatch) => Dispatch;
