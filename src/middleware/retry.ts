import { CanceledError } from '../errors/CanceledError';
import { normalizeAbortError } from '../internals/normalize-error';
import { parseRetryAfter } from '../internals/retry-after';
import { sleep } from '../internals/sleep';
import type { FetchMiddleware } from '../types/Middleware';
import type { RetryOptions } from '../types/RetryOptions';

const DEFAULT_METHODS = ['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE', 'TRACE', 'QUERY'];
const DEFAULT_STATUS_CODES = [408, 429, 500, 502, 503, 504];

function applyJitter(delay: number, jitter: RetryOptions['jitter']): number {
  if (jitter === true) return Math.random() * delay;
  if (typeof jitter === 'function') {
    const jittered = jitter(delay);
    return Number.isFinite(jittered) && jittered >= 0 ? jittered : delay;
  }
  return delay;
}

/**
 * The built-in retry middleware. There is no config-level shortcut for it — add it to a
 * `FetchInstance`'s `middlewares` array yourself, wherever in the stack you want it:
 * `fr.create({ middlewares: [retry({ limit: 3 })] })`.
 *
 * **Precondition**: core dispatch must clear `ctx.response` at the start of every attempt and
 * only set it again on success — otherwise an attempt that fails with a network error would
 * inherit the previous attempt's (retryable-status) response, and wrongly reuse that response's
 * `Retry-After` header even though this attempt has no response of its own.
 */
export function retry(options: RetryOptions = {}): FetchMiddleware {
  const {
    limit = 2,
    methods = DEFAULT_METHODS,
    statusCodes = DEFAULT_STATUS_CODES,
    minTimeout = 300,
    maxTimeout = Infinity,
    factor = 2,
    jitter,
    shouldRetry,
    onFailedAttempt,
  } = options;

  return (next) => async (ctx) => {
    if (!methods.includes(ctx.request.method.toUpperCase())) {
      return next(ctx);
    }

    let attempt = 0;
    while (true) {
      const canRetry = attempt < limit;
      // Clone before sending, while the body is still untouched — cloning after a failure hits a
      // TypeError since the body's already disturbed. Skipped entirely once no retries remain, to
      // avoid tee()'s cost of buffering the whole stream.
      const spare = canRetry ? ctx.request.clone() : undefined;

      try {
        await next(ctx);
        if (!ctx.response || !statusCodes.includes(ctx.response.status) || !spare) return;
      } catch (error) {
        // Default: never retry a CanceledError (an explicit user cancellation). shouldRetry can
        // override this default judgment, e.g. for a case that wants cancellations retried too.
        const retryable = shouldRetry ? shouldRetry({ error, attempt }) : !(error instanceof CanceledError);
        if (!spare || !retryable) throw error;
      }

      attempt++;
      onFailedAttempt?.({ attempt, response: ctx.response });
      ctx.request = spare;

      const serverDelay = ctx.response ? parseRetryAfter(ctx.response.headers) : undefined;
      // No jitter once the server has specified a timing — a deterministic server instruction wins.
      const delay = serverDelay ?? applyJitter(Math.min(minTimeout * factor ** (attempt - 1), maxTimeout), jitter);
      try {
        await sleep(delay, ctx.signal);
      } catch {
        // sleep() rejects with the raw signal.reason — normalize a cancellation during the retry
        // wait into a FetchError subclass (CanceledError/TimeoutError), same as every other failure path.
        throw normalizeAbortError(ctx.signal, ctx.request);
      }
    }
  };
}
