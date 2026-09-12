import type { RequestOptions } from './RequestOptions';

/** The low-level shape accepted by `FetchInstance.send()` — what `get()`/`post()`/etc. build internally. */
export type FetchRequest = { method: string; url: string; body?: unknown } & RequestOptions;
