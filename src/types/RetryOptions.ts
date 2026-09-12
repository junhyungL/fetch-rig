/** Options for the built-in {@link retry} middleware. */
export interface RetryOptions {
  /** Default 2. */
  limit?: number;
  /** Default GET/HEAD/OPTIONS/PUT/DELETE/TRACE/QUERY (idempotent methods only). */
  methods?: string[];
  /** Default [408, 429, 500, 502, 503, 504]. */
  statusCodes?: number[];
  /** Default 300ms. */
  minTimeout?: number;
  /** Default Infinity. */
  maxTimeout?: number;
  /** Exponential backoff base. Default 2. */
  factor?: number;
  /** Off by default. `true` applies full jitter (uniform between 0 and the computed delay); a function lets you compute it yourself. */
  jitter?: boolean | ((delay: number) => number);
  /** The default is to never retry a `CanceledError` — passing this option overrides that default judgment. */
  shouldRetry?: (ctx: { error: unknown; attempt: number }) => boolean;
  onFailedAttempt?: (ctx: { attempt: number; response?: Response }) => void;
}
