import { normalizeError } from './normalize-error';
import { supportsDuplex } from './duplex-support';
import { withDownloadProgress, withUploadProgress } from './progress';
import type { Dispatch, FetchContext } from '../types/Middleware';

async function send(request: Request, ctx: FetchContext): Promise<void> {
  const rawResponse = await fetch(request);
  ctx.response = withDownloadProgress(rawResponse, ctx.onDownload, ctx.maxDownloadBytes);
}

/**
 * The innermost link in the chain — the base `Dispatch` that actually calls `fetch()`.
 * `FetchInstance` wraps this in `compose(middlewares, dispatch)` to build its full chain.
 *
 * `ctx.request` already carries its composed signal from `normalizeRequest()`, so calling
 * `fetch(ctx.request)` alone is enough to apply method/headers/body/duplex/signal.
 *
 * Progress wrapping (`ctx.onUpload`/`ctx.onDownload`) is applied to a local variable, not to
 * `ctx.request` itself, so it never ends up on the spare clone `retry` keeps around — that's
 * what keeps progress from double-counting across retries.
 *
 * `ctx.response` is cleared at the start of every attempt: `retry` assumes an attempt that fails
 * with a network error never inherits a previous attempt's response, and this is where that
 * invariant is upheld.
 *
 * Error normalization also happens here rather than in `compose()`, so every middleware
 * (including `retry`) only ever catches a `FetchError` subclass, never a raw `DOMException`.
 */
export const dispatch: Dispatch = async (ctx) => {
  ctx.response = undefined;

  // Below is the only case where a streamed upload is actually attempted.
  if (ctx.onUpload && supportsDuplex && ctx.request.body) {
    // Some runtimes (Chrome) accept `duplex: 'half'` when a Request is constructed, but refuse to
    // actually send it if HTTP/2 negotiation (ALPN/TLS) fails — a plain HTTP/1.1 server commonly
    // triggers this — rejecting before a single byte goes out. That failure shouldn't break the
    // upload just because streaming was requested, so if (and only if) nothing was sent yet, retry
    // once without streaming — mirroring what a runtime with no duplex support (Firefox) already
    // does silently. A failure after any byte went out might already have reached the server, so
    // it's never silently retried (same non-idempotent-retry principle as the `retry` middleware).
    const spare = ctx.request.clone();
    let started = false;
    const primary = withUploadProgress(ctx.request, ctx.uploadBytes ?? 0, ctx.onUpload, () => {
      started = true;
    });

    try {
      await send(primary, ctx);
      return;
    } catch (error) {
      // Only fall through to the fallback if nothing was sent yet and this wasn't an abort;
      // every other failure is normalized and thrown immediately.
      if (ctx.signal.aborted || started) throw normalizeError(error, ctx.signal, ctx.request);
    }

    try {
      await send(spare, ctx);
      return;
    } catch (fallbackError) {
      throw normalizeError(fallbackError, ctx.signal, ctx.request);
    }
  }

  try {
    await send(
      ctx.onUpload
        ? withUploadProgress(ctx.request, ctx.uploadBytes ?? 0, ctx.onUpload)
        : ctx.request,
      ctx,
    );
  } catch (error) {
    throw normalizeError(error, ctx.signal, ctx.request);
  }
};
