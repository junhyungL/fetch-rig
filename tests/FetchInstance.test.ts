import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { fr } from '../src/index';
import { FetchInstance } from '../src/FetchInstance';
import { FetchResponse } from '../src/FetchResponse';
import { HTTPError } from '../src/errors/HTTPError';
import { retry } from '../src/middleware/retry';
import type { FetchMiddleware } from '../src/types/Middleware';

let attempts = 0;
let lastAuthHeader: string | null = null;
let lastRequestUrl = '';

const server = setupServer(
  http.get('https://api.example.com/ping', () => HttpResponse.json({ pong: true })),
  http.get('https://api.example.com/broken', () =>
    HttpResponse.json({ message: 'nope' }, { status: 500 }),
  ),
  http.post('https://api.example.com/echo', async ({ request }) => {
    const body = await request.json();
    return HttpResponse.json(body);
  }),
  http.head('https://api.example.com/resource', () => new HttpResponse(null, { status: 200 })),
  http.options(
    'https://api.example.com/resource',
    () => new HttpResponse(null, { status: 204, headers: { Allow: 'GET, HEAD, OPTIONS' } }),
  ),
  http.delete('https://api.example.com/resource/1', () => new HttpResponse(null, { status: 204 })),
  http.put('https://api.example.com/resource/1', async ({ request }) =>
    HttpResponse.json(await request.json()),
  ),
  http.patch('https://api.example.com/resource/1', async ({ request }) =>
    HttpResponse.json(await request.json()),
  ),
  http.get('https://api.example.com/flaky-instance', () => {
    attempts++;
    if (attempts < 2)
      return HttpResponse.json({}, { status: 503, headers: { 'Retry-After': '0' } });
    return HttpResponse.json({ recovered: true });
  }),
  http.get('https://api.example.com/protected', ({ request }) => {
    lastAuthHeader = request.headers.get('authorization');
    if (lastAuthHeader !== 'Bearer fresh-token') {
      return HttpResponse.json({}, { status: 401 });
    }
    return HttpResponse.json({ secret: 42 });
  }),
  http.get('https://api.example.com/echo-url', ({ request }) => {
    lastRequestUrl = request.url;
    return HttpResponse.json({ ok: true });
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  attempts = 0;
  lastAuthHeader = null;
  lastRequestUrl = '';
});
afterAll(() => server.close());

describe('FetchInstance / fr', () => {
  it('fr.get performs a basic request against the default instance', async () => {
    const response = await fr.get('https://api.example.com/ping');
    expect(response).toBeInstanceOf(FetchResponse);
    await expect(response.json()).resolves.toEqual({ pong: true });
  });

  it('create() builds a scoped instance with its own baseUrl', async () => {
    const api = fr.create({ baseUrl: 'https://api.example.com' });
    expect(api).toBeInstanceOf(FetchInstance);
    const response = await api.get('/ping');
    await expect(response.json()).resolves.toEqual({ pong: true });
  });

  it('head/options/delete/put/patch all reach the right endpoint with the right method', async () => {
    const api = fr.create({ baseUrl: 'https://api.example.com' });

    const headRes = await api.head('/resource');
    expect(headRes.status).toBe(200);

    const optionsRes = await api.options('/resource');
    expect(optionsRes.status).toBe(204);
    expect(optionsRes.headers.get('allow')).toBe('GET, HEAD, OPTIONS');

    const deleteRes = await api.delete('/resource/1');
    expect(deleteRes.status).toBe(204);

    const putRes = await api.put('/resource/1', { name: 'updated' });
    await expect(putRes.json()).resolves.toEqual({ name: 'updated' });

    const patchRes = await api.patch('/resource/1', { name: 'patched' });
    await expect(patchRes.json()).resolves.toEqual({ name: 'patched' });
  });

  it('post() sends and auto-serializes a JSON body', async () => {
    const api = fr.create({ baseUrl: 'https://api.example.com' });
    const response = await api.post('/echo', { a: 1 });
    await expect(response.json()).resolves.toEqual({ a: 1 });
  });

  it('returns a plain FetchResponse for a non-2xx status when throwOnError is false (default)', async () => {
    const api = fr.create({ baseUrl: 'https://api.example.com' });
    const response = await api.get('/broken');
    expect(response.ok).toBe(false);
    expect(response.status).toBe(500);
  });

  it('throws HTTPError for a non-2xx status when throwOnError is true', async () => {
    const api = fr.create({ baseUrl: 'https://api.example.com', throwOnError: true });
    await expect(api.get('/broken')).rejects.toBeInstanceOf(HTTPError);
  });

  it('lets a per-call throwOnError override the instance default', async () => {
    const api = fr.create({ baseUrl: 'https://api.example.com', throwOnError: true });
    const response = await api.get('/broken', { throwOnError: false });
    expect(response.ok).toBe(false);
  });

  it('throwOnError as a function fully replaces the default 2xx check, receiving the real status', async () => {
    const seenStatuses: number[] = [];
    const api = fr.create({
      baseUrl: 'https://api.example.com',
      throwOnError: (status) => {
        seenStatuses.push(status);
        return false; // never throw, even for the 500 from /broken — a custom, looser policy
      },
    });

    const response = await api.get('/broken');

    expect(response.ok).toBe(false);
    expect(response.status).toBe(500);
    expect(seenStatuses).toEqual([500]);
  });

  it('throwOnError as a function can throw even for a 2xx status — it is not gated by response.ok', async () => {
    const api = fr.create({
      baseUrl: 'https://api.example.com',
      throwOnError: (status) => status === 200, // a deliberately unusual, stricter-than-default policy
    });

    await expect(api.get('/ping')).rejects.toBeInstanceOf(HTTPError);
  });

  it('retries through a real flaky endpoint when retry is configured', async () => {
    const api = fr.create({
      baseUrl: 'https://api.example.com',
      middlewares: [retry({ limit: 3 })],
    });
    const response = await api.get('/flaky-instance');
    expect(attempts).toBe(2);
    await expect(response.json()).resolves.toEqual({ recovered: true });
  });

  it('runs a user middleware that refreshes auth on 401 and retries the request', async () => {
    let token = 'stale-token';
    const authMiddleware: FetchMiddleware = (next) => async (ctx) => {
      ctx.request.headers.set('Authorization', `Bearer ${token}`);
      await next(ctx);
      if (ctx.response?.status === 401) {
        token = 'fresh-token';
        ctx.request = ctx.request.clone();
        ctx.request.headers.set('Authorization', `Bearer ${token}`);
        await next(ctx);
      }
    };

    const api = fr.create({ baseUrl: 'https://api.example.com', middlewares: [authMiddleware] });
    const response = await api.get('/protected');

    expect(lastAuthHeader).toBe('Bearer fresh-token');
    await expect(response.json()).resolves.toEqual({ secret: 42 });
  });

  it('merges per-call query/headers on top of the instance config', async () => {
    const api = fr.create({ baseUrl: 'https://api.example.com', headers: { 'X-Instance': '1' } });
    await api.get('/echo-url', { query: { page: 2 }, headers: { 'X-Call': '1' } });
    expect(lastRequestUrl).toBe('https://api.example.com/echo-url?page=2');
  });

  it('lets a per-call signal cancel the request', async () => {
    const api = fr.create({ baseUrl: 'https://api.example.com' });
    const controller = new AbortController();
    controller.abort('stop');
    await expect(api.get('/ping', { signal: controller.signal })).rejects.toMatchObject({
      reason: 'stop',
    });
  });

  it('raises a clear internal error if a misbehaving middleware short-circuits without producing a response', async () => {
    const brokenMiddleware: FetchMiddleware = () => async () => {
      // Never calls next() and never sets ctx.response — an invalid middleware.
    };
    const api = fr.create({ baseUrl: 'https://api.example.com', middlewares: [brokenMiddleware] });
    await expect(api.get('/ping')).rejects.toThrow(/completed without producing a response/);
  });
});
