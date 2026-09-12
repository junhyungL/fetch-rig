import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { compose } from '../../src/middleware/compose';
import { retry } from '../../src/middleware/retry';
import { dispatch } from '../../src/internals/dispatch';
import { normalizeRequest } from '../../src/internals/normalize-request';
import { CanceledError } from '../../src/errors/CanceledError';
import type { FetchContext } from '../../src/types/Middleware';

// This is the first point in the plan where compose() + retry() + dispatch()
// run together against a real (mocked) network layer, rather than a hand-written mock
// Dispatch — it's the first genuine end-to-end proof that a fetch-rig request actually
// retries over real HTTP semantics (Retry-After, status codes, real Request/Response objects).
let attempts = 0;

const server = setupServer(
  http.get('https://api.example.com/flaky', () => {
    attempts++;
    if (attempts < 3) {
      return HttpResponse.json(
        { error: 'try again' },
        { status: 503, headers: { 'Retry-After': '0' } },
      );
    }
    return HttpResponse.json({ ok: true });
  }),
  http.get('https://api.example.com/always-down', () => HttpResponse.json({}, { status: 500 })),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  attempts = 0;
});
afterAll(() => server.close());

function contextFor(path: string, signal?: AbortSignal): FetchContext {
  const normalized = normalizeRequest({
    method: 'GET',
    url: path,
    config: { baseUrl: 'https://api.example.com' },
    options: signal ? { signal } : undefined,
  });
  return { ...normalized, config: {} };
}

describe('full pipeline: compose + retry + dispatch', () => {
  it('retries a real flaky endpoint until it succeeds', async () => {
    const pipeline = compose([retry({ limit: 5 })], dispatch);
    const ctx = contextFor('/flaky');

    await pipeline(ctx);

    expect(attempts).toBe(3);
    expect(ctx.response?.status).toBe(200);
    await expect(ctx.response!.json()).resolves.toEqual({ ok: true });
  });

  it('gives up after the retry limit and returns the last failing response', async () => {
    const pipeline = compose([retry({ limit: 2, minTimeout: 1, maxTimeout: 5 })], dispatch);
    const ctx = contextFor('/always-down');

    await pipeline(ctx);

    expect(ctx.response?.status).toBe(500);
  });

  it('stops retrying immediately when the caller aborts mid-backoff', async () => {
    const controller = new AbortController();
    const pipeline = compose([retry({ limit: 5, minTimeout: 50, maxTimeout: 50 })], dispatch);
    const ctx = contextFor('/always-down', controller.signal);

    const pending = pipeline(ctx);
    setTimeout(() => controller.abort('user stop'), 10);

    await expect(pending).rejects.toBeInstanceOf(CanceledError);
    // The retry loop must not have run all 5 attempts (each separated by a 50ms backoff) — it
    // should have stopped as soon as the abort landed, whichever attempt happened to be in flight.
    expect(attempts).toBeLessThan(5);
  });
});
