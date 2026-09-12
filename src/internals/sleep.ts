/**
 * A delay that can be canceled immediately via `AbortSignal` — used for the wait between retries.
 *
 * Rejects with `signal.reason` verbatim, even though it may not be an `Error` instance — the
 * caller (`retry.ts`) always normalizes it through `normalizeAbortError()`, so there's no need to
 * wrap it here.
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      reject(signal.reason);
      return;
    }

    const onAbort = () => {
      clearTimeout(timeoutId);
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      reject(signal!.reason);
    };

    const timeoutId = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
