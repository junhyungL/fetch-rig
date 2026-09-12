/** Passed to `onUpload`/`onDownload` on each reported chunk. */
export interface ProgressInfo {
  /** 0~1. Always 0 if `total` can't be determined (no Content-Length). */
  progress: number;
  /** 0 if there's no Content-Length. */
  total: number;
  loaded: number;
  /**
   * Average bytes/sec since the transfer's first chunk — a simple running average, not a
   * smoothed/windowed instantaneous rate, so it reacts slowly to sudden speed changes mid-transfer.
   * Undefined until there's been measurable elapsed time (effectively: never present on the very
   * first chunk, and never present at all for a zero-chunk/empty body).
   */
  rate?: number;
  /** Estimated seconds remaining, derived from `rate`. Undefined whenever `rate` is, or when `total` isn't known. */
  estimated?: number;
}
