import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { delay, http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { dispatch } from '../../src/internals/dispatch';
import { normalizeRequest } from '../../src/internals/normalize-request';
import { CanceledError } from '../../src/errors/CanceledError';
import { NetworkError } from '../../src/errors/NetworkError';
import { TimeoutError } from '../../src/errors/TimeoutError';
import type { FetchContext } from '../../src/types/Middleware';

const server = setupServer(
  http.get('https://api.example.com/ok', () => HttpResponse.json({ ok: true })),
  http.get('https://api.example.com/slow', async () => {
    await delay(200);
    return HttpResponse.json({ ok: true });
  }),
  http.get('https://api.example.com/network-error', () => HttpResponse.error()),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function contextFor(path: string, options?: Parameters<typeof normalizeRequest>[0]['options']): FetchContext {
  const { request, signal } = normalizeRequest({
    method: 'GET',
    url: path,
    config: { baseUrl: 'https://api.example.com' },
    options,
  });
  return { request, signal, config: {} };
}

describe('dispatch', () => {
  it('sets ctx.response on success', async () => {
    const ctx = contextFor('/ok');
    await dispatch(ctx);
    expect(ctx.response?.status).toBe(200);
    await expect(ctx.response!.json()).resolves.toEqual({ ok: true });
  });

  it('throws NetworkError when fetch itself fails (not via abort)', async () => {
    const ctx = contextFor('/network-error');
    await expect(dispatch(ctx)).rejects.toBeInstanceOf(NetworkError);
  });

  it('throws CanceledError, carrying the reason, when the user aborts mid-request', async () => {
    const controller = new AbortController();
    const ctx = contextFor('/slow', { signal: controller.signal });

    const pending = dispatch(ctx);
    controller.abort('user stop');

    await expect(pending).rejects.toBeInstanceOf(CanceledError);
    await expect(pending).rejects.toMatchObject({ reason: 'user stop' });
  });

  it('throws TimeoutError when the configured timeout elapses before the response', async () => {
    const ctx = contextFor('/slow', { timeout: 20 });
    await expect(dispatch(ctx)).rejects.toBeInstanceOf(TimeoutError);
  });

  it('clears a stale ctx.response left over from a previous attempt before this one settles', async () => {
    const ctx = contextFor('/network-error');
    ctx.response = new Response(null, { status: 500 }); // simulate a prior attempt's retryable response

    await expect(dispatch(ctx)).rejects.toBeInstanceOf(NetworkError);
    expect(ctx.response).toBeUndefined();
  });
});
