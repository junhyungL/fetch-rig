import { CanceledError } from '../errors/CanceledError';
import { NetworkError } from '../errors/NetworkError';
import { TimeoutError } from '../errors/TimeoutError';

function isTimeoutReason(reason: unknown): boolean {
  return reason instanceof DOMException && reason.name === 'TimeoutError';
}

/**
 * Normalizes a failure caused by an aborted signal into the right `FetchError`. Uses
 * `signal.reason` to tell an `AbortSignal.timeout()`-triggered abort apart from any other
 * (a direct user `abort()`). Kept in one place because `dispatch` (fetch itself fails) and
 * `retry` (canceled during its backoff wait) both need this same distinction.
 */
export function normalizeAbortError(signal: AbortSignal, request: Request): TimeoutError | CanceledError {
  return isTimeoutReason(signal.reason) ? new TimeoutError(request) : new CanceledError(signal.reason);
}

/**
 * Normalizes an error thrown by `fetch()` itself — via `normalizeAbortError()` if the signal is
 * aborted, otherwise wrapped as `NetworkError`. Consolidates a check `dispatch.ts` would
 * otherwise repeat across its three call sites (streamed attempt, fallback attempt, plain path).
 */
export function normalizeError(error: unknown, signal: AbortSignal, request: Request): TimeoutError | CanceledError | NetworkError {
  return signal.aborted ? normalizeAbortError(signal, request) : new NetworkError(error);
}
