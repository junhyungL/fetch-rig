import type { Dispatch, FetchMiddleware } from '../types/Middleware';

/**
 * Composes a middleware stack into a single `Dispatch`.
 *
 * Uses a function-wrapping model — the same family as undici's `Dispatcher.compose()` and Redux
 * middleware, not Koa's "ctx + next callback." `next` is a plain function reference callable any
 * number of times, so `retry` looping on it or an auth-refresh middleware calling it again after
 * a 401 both just work. (A Koa-style "throw if next() is called twice" guard is deliberately
 * omitted.)
 *
 * `reduceRight` makes registration order the outside-in wrapping order, so the request phase runs
 * in registration order and the response phase in reverse — the onion structure falls out of that
 * naturally.
 *
 * No error normalization happens here — this assumes only an already-normalized `FetchError`
 * subclass, produced by `core` (the innermost link, the real `fetch()` call), ever propagates up
 * through this chain.
 *
 * There's deliberately no runtime guard for a middleware that returns without awaiting
 * `next(ctx)` — a koa-compose-style check for that is really a race on microtask timing, not
 * middleware structure, and testing showed it misses real cases whenever `next(ctx)` resolves
 * quickly (a mock, a cache hit). Better caught by lint rules like
 * `@typescript-eslint/no-floating-promises`/`require-await` on the middleware author's side.
 */
export function compose(middlewares: FetchMiddleware[], core: Dispatch): Dispatch {
  return middlewares.reduceRight<Dispatch>((next, middleware) => middleware(next), core);
}
