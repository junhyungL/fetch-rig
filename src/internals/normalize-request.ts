import { getSize, serialize } from './body';
import { supportsDuplex } from './duplex-support';
import { buildUrl } from './url';
import type { FetchConfig } from '../types/FetchConfig';
import type { RequestOptions } from '../types/RequestOptions';

export interface NormalizeRequestInput {
  method: string;
  url: string;
  body?: unknown;
  config: FetchConfig;
  options?: RequestOptions;
}

export interface NormalizedRequest {
  request: Request;
  /** The user's signal composed with the timeout signal — stays the same across every retry attempt. */
  signal: AbortSignal;
  /** Byte size of the serialized body (for upload progress) — computed here since it can't be read back off a constructed `Request`. */
  uploadBytes: number;
}

/**
 * Assembles a `Request` in six steps before it enters the middleware stack. Order matters here —
 * e.g. header merging must happen before auto-serialization, so serialization can see any
 * Content-Type the caller already set.
 */
export function normalizeRequest({
  method,
  url,
  body,
  config,
  options,
}: NormalizeRequestInput): NormalizedRequest {
  // 1. Merge headers — instance, then per-call on top (per-call wins).
  const headers = new Headers(config.headers);
  if (options?.headers) {
    new Headers(options.headers).forEach((value, key) => headers.set(key, value));
  }

  // 2. Auto-serialize — looks at both the body's type and the Content-Type merged in step 1.
  const serialized = serialize(body, headers.get('content-type') ?? undefined);
  if (serialized.contentType === null) {
    headers.delete('content-type');
  } else if (serialized.contentType !== undefined) {
    headers.set('content-type', serialized.contentType);
  }

  // 4. Build the URL — baseUrl + path (= url) + query (instance-level query doesn't exist, only per-call).
  const finalUrl = buildUrl({ baseUrl: config.baseUrl, path: url, query: options?.query });

  // 5. Compose the abort signal — per-call signal + timeout signal into one. With neither, the
  // result never aborts.
  const signals: AbortSignal[] = [];
  if (options?.signal) signals.push(options.signal);
  const timeout = options?.timeout ?? config.timeout;
  if (timeout !== undefined) signals.push(AbortSignal.timeout(timeout));
  const signal = AbortSignal.any(signals);

  // 3 + 6. Set duplex (whenever the runtime supports it, regardless of body type) + build the Request.
  const init: RequestInit & { duplex?: 'half' } = {
    method,
    headers,
    body: serialized.body,
    redirect: config.redirect,
    credentials: config.credentials,
    cache: config.cache,
    keepalive: config.keepalive,
    signal,
  };
  if (supportsDuplex) {
    init.duplex = 'half';
  }

  return { request: new Request(finalUrl, init), signal, uploadBytes: getSize(serialized.body) };
}
