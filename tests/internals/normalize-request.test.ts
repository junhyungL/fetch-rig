import { describe, expect, it } from 'vitest';
import { normalizeRequest } from '../../src/internals/normalize-request';

describe('normalizeRequest', () => {
  it('merges instance and per-call headers, per-call taking precedence', () => {
    const { request } = normalizeRequest({
      method: 'GET',
      url: '/x',
      config: { baseUrl: 'https://api.example.com', headers: { 'X-A': '1', 'X-B': '1' } },
      options: { headers: { 'X-B': '2' } },
    });
    expect(request.headers.get('x-a')).toBe('1');
    expect(request.headers.get('x-b')).toBe('2');
  });

  it('lets an explicit per-call Content-Type steer body serialization', () => {
    const { request } = normalizeRequest({
      method: 'POST',
      url: '/x',
      body: { a: '1', b: '2' },
      config: { baseUrl: 'https://api.example.com' },
      options: { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    });
    expect(request.headers.get('content-type')).toBe('application/x-www-form-urlencoded');
  });

  it('defaults to JSON when no Content-Type hint is present', async () => {
    const { request } = normalizeRequest({
      method: 'POST',
      url: '/x',
      body: { a: 1 },
      config: { baseUrl: 'https://api.example.com' },
    });
    expect(request.headers.get('content-type')).toBe('application/json;charset=UTF-8');
    await expect(request.json()).resolves.toEqual({ a: 1 });
  });

  it('strips a stale Content-Type header for a FormData body so the runtime sets its own boundary', () => {
    const form = new FormData();
    form.append('a', '1');
    const { request } = normalizeRequest({
      method: 'POST',
      url: '/x',
      body: form,
      config: { baseUrl: 'https://api.example.com', headers: { 'Content-Type': 'application/json' } },
    });
    // Must not be the stale 'application/json' — the runtime fills in multipart/form-data;
    // boundary=... once the body is actually sent.
    expect(request.headers.get('content-type')).not.toBe('application/json');
  });

  it('builds the final URL from baseUrl + path + query', () => {
    const { request } = normalizeRequest({
      method: 'GET',
      url: '/users',
      config: { baseUrl: 'https://api.example.com' },
      options: { query: { page: 2 } },
    });
    expect(request.url).toBe('https://api.example.com/users?page=2');
  });

  it('lets an absolute url bypass baseUrl', () => {
    const { request } = normalizeRequest({
      method: 'GET',
      url: 'https://other.com/x',
      config: { baseUrl: 'https://api.example.com' },
    });
    expect(request.url).toBe('https://other.com/x');
  });

  it('composes a signal that never aborts when neither per-call signal nor timeout is set', () => {
    const { signal } = normalizeRequest({
      method: 'GET',
      url: '/x',
      config: { baseUrl: 'https://api.example.com' },
    });
    expect(signal.aborted).toBe(false);
  });

  it('propagates abort + reason from the per-call signal to the composed signal', () => {
    const controller = new AbortController();
    const { signal } = normalizeRequest({
      method: 'GET',
      url: '/x',
      config: { baseUrl: 'https://api.example.com' },
      options: { signal: controller.signal },
    });

    controller.abort('stop');

    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBe('stop');
  });

  it('accepts a streaming body without throwing (duplex is set for supporting runtimes)', () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      },
    });
    expect(() =>
      normalizeRequest({
        method: 'POST',
        url: '/x',
        body: stream,
        config: { baseUrl: 'https://api.example.com' },
      }),
    ).not.toThrow();
  });

  it('passes redirect/credentials/cache/keepalive through from config to the Request', () => {
    const { request } = normalizeRequest({
      method: 'GET',
      url: '/x',
      config: {
        baseUrl: 'https://api.example.com',
        redirect: 'manual',
        credentials: 'include',
        cache: 'no-store',
        keepalive: true,
      },
    });

    expect(request.redirect).toBe('manual');
    expect(request.credentials).toBe('include');
    expect(request.cache).toBe('no-store');
    expect(request.keepalive).toBe(true);
  });
});
