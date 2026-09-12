import type { FetchMiddleware } from './Middleware';

/** Options for {@link FetchInstance.create}, shared by every request made through that instance. */
export interface FetchConfig {
  baseUrl?: string;
  headers?: HeadersInit;
  /** ms, a single timeout. */
  timeout?: number;
  /** Default false. Pass a function to fully replace the default "non-2xx throws" check — return `true` to throw `HTTPError` for that status. */
  throwOnError?: boolean | ((status: number) => boolean);
  /** Aborts a response (with `TooLargeError`) once its body exceeds this many bytes. Checked against bytes actually received, not the (possibly absent or untrustworthy) `Content-Length` header. Unset by default — no limit. */
  maxDownloadBytes?: number;
  /** To retry, add `retry(options)` to this array — see the `retry` export. */
  middlewares?: FetchMiddleware[];
  /** Delegated to the fetch standard as-is. */
  redirect?: RequestRedirect;
  credentials?: RequestCredentials;
  cache?: RequestCache;
  keepalive?: boolean;
}
