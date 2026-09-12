/**
 * Feature-detects whether the current runtime supports streaming request bodies
 * (`duplex: 'half'`) — the widely-used trick of checking whether the `Request` constructor
 * actually reads a `duplex` getter.
 *
 * Computed once at module load (ES modules are per-process singletons, so this runs exactly once
 * no matter how many places import the module) rather than on every request.
 */
export const supportsDuplex: boolean = (() => {
  let duplexAccessed = false;
  try {
    new Request('https://fetch-rig.invalid', {
      method: 'POST',
      body: new ReadableStream(),
      get duplex() {
        duplexAccessed = true;
        return 'half';
      },
    } as RequestInit);
  } catch {
    // Even if construction itself throws (e.g. a runtime with no body-streaming support at all),
    // duplexAccessed still holds a valid answer.
  }
  return duplexAccessed;
})();
