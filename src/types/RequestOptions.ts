import type { ProgressInfo } from './ProgressInfo';
import type { QueryInit } from './Query';

/** Per-call options accepted by `get()`/`post()`/etc., layered on top of the instance's {@link FetchConfig}. */
export interface RequestOptions {
  query?: QueryInit;
  /** Merged with the instance's headers — the per-call value wins (overwrites). */
  headers?: HeadersInit;
  /** Composed with the instance's timeout signal via AbortSignal.any(). */
  signal?: AbortSignal;
  /** Applies to this call only, overriding the instance's timeout. */
  timeout?: number;
  /** Applies to this call only, overriding the instance's value. */
  throwOnError?: boolean | ((status: number) => boolean);
  /** Applies to this call only, overriding the instance's value. */
  maxDownloadBytes?: number;
  onUpload?: (event: ProgressInfo, chunk: Uint8Array) => void;
  onDownload?: (event: ProgressInfo, chunk: Uint8Array) => void;
}
