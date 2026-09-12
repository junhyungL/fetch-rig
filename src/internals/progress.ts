import { supportsDuplex } from './duplex-support';
import { TooLargeError } from '../errors/TooLargeError';
import type { ProgressInfo } from '../types/ProgressInfo';

export type ProgressCallback = (event: ProgressInfo, chunk: Uint8Array) => void;

/**
 * Wraps a stream in a `TransformStream` that tallies chunk byte counts, ported from ky's
 * progress-tracking algorithm. Each chunk is published one tick late — reporting the last chunk
 * immediately would hit 100% before the stream is actually done, and `flush()` is what finalizes
 * progress at 1.
 *
 * `onStart`, unlike `onProgress`, fires synchronously and without delay the moment the first
 * chunk is actually read — `dispatch.ts` uses it to tell whether an upload made any real
 * progress at all, which `onProgress` can't answer since it defers publishing the first chunk.
 *
 * `rate`/`estimated` are a cumulative average since the first chunk, not a sliding-window average
 * like axios's `Speedometer` — a deliberate simplification, so they react slowly to a sudden
 * mid-transfer speed change. Both are `undefined` on the first chunk, when `elapsedSeconds` is
 * still 0 and there's nothing to compute from yet.
 */
function withProgress(
  stream: ReadableStream<Uint8Array>,
  total: number,
  onProgress: ProgressCallback,
  onStart?: () => void,
): ReadableStream<Uint8Array> {
  let previousChunk: Uint8Array | undefined;
  let loaded = 0;
  let started = false;
  let startTime = 0;

  function rateFields(bytesSoFar: number): Pick<ProgressInfo, 'rate' | 'estimated'> {
    if (!started) return {};
    const elapsedSeconds = (performance.now() - startTime) / 1000;
    if (elapsedSeconds <= 0) return {};
    const rate = bytesSoFar / elapsedSeconds;
    const estimated = total > 0 && rate > 0 ? (total - bytesSoFar) / rate : undefined;
    return { rate, estimated };
  }

  return stream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        if (!started) {
          started = true;
          startTime = performance.now();
          onStart?.();
        }
        controller.enqueue(chunk);
        if (previousChunk) {
          loaded += previousChunk.byteLength;
          let progress = total === 0 ? 0 : loaded / total;
          if (progress >= 1) progress = 1 - Number.EPSILON;
          onProgress(
            { progress, total: Math.max(total, loaded), loaded, ...rateFields(loaded) },
            previousChunk,
          );
        }
        previousChunk = chunk;
      },
      flush() {
        const finalChunk = previousChunk ?? new Uint8Array();
        loaded += finalChunk.byteLength;
        onProgress(
          { progress: 1, total: Math.max(total, loaded), loaded, ...rateFields(loaded) },
          finalChunk,
        );
      },
    }),
  );
}

/**
 * Wraps a request body in a progress-tracking stream. On a runtime without `duplex: 'half'`
 * support, returns the original request untouched — the callback is silently never called.
 */
export function withUploadProgress(
  request: Request,
  total: number,
  onProgress: ProgressCallback,
  onStart?: () => void,
): Request {
  if (!request.body || !supportsDuplex) return request;
  return new Request(request, {
    duplex: 'half',
    body: withProgress(request.body, total, onProgress, onStart),
  } as RequestInit);
}

/**
 * Errors the stream out the moment real received bytes exceed `maxBytes`. Deliberately kept
 * separate from `withProgress`'s one-chunk-delayed publishing — a size limit is a safety net, so
 * it checks the running total the instant each chunk arrives, with no delay. Never trusts the
 * `Content-Length` header, since it can be absent or lie; only actually-received bytes count.
 */
function withMaxSize(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
): ReadableStream<Uint8Array> {
  let receivedBytes = 0;
  return stream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        receivedBytes += chunk.byteLength;
        if (receivedBytes > maxBytes) {
          controller.error(new TooLargeError(maxBytes, receivedBytes));
          return;
        }
        controller.enqueue(chunk);
      },
    }),
  );
}

/**
 * Wraps a response body in a progress-tracking stream, estimating `total` from `Content-Length`
 * when present. Returns the original response untouched if neither `onProgress` nor `maxBytes`
 * is given.
 */
export function withDownloadProgress(
  response: Response,
  onProgress?: ProgressCallback,
  maxBytes?: number,
): Response {
  if (!response.body || response.status === 204) return response;
  if (!onProgress && maxBytes === undefined) return response;

  let body: ReadableStream<Uint8Array> = response.body;
  if (maxBytes !== undefined) {
    body = withMaxSize(body, maxBytes);
  }
  if (onProgress) {
    const total = Math.max(0, Number(response.headers.get('content-length')) || 0);
    body = withProgress(body, total, onProgress);
  }

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
