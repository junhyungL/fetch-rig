import { afterEach, describe, expect, it, vi } from 'vitest';
import { dispatch } from '../../src/internals/dispatch';
import { normalizeRequest } from '../../src/internals/normalize-request';
import { CanceledError } from '../../src/errors/CanceledError';
import { NetworkError } from '../../src/errors/NetworkError';
import type { FetchContext } from '../../src/types/Middleware';

// Real browsers can refuse a *streamed* (duplex: 'half') upload before a single byte leaves the
// client — e.g. Chrome requires HTTP/2 (ALPN) for it and rejects outright over plain HTTP/1.1
// (confirmed via a real Chrome run against a local HTTP/1.1 server; see docs/ARCHITECTURE.md's
// "Upload/download progress" section).
// MSW/Node have no such restriction, so this can't be reproduced through a real request — instead
// these tests stub `fetch` directly to deterministically simulate "failed before any byte sent"
// vs. "failed after some bytes were already sent", and assert dispatch's fallback decision.

function contextForUpload(onUpload: FetchContext['onUpload'], signal?: AbortSignal): FetchContext {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      controller.enqueue(new Uint8Array([4, 5, 6]));
      controller.close();
    },
  });
  const { request, signal: composedSignal } = normalizeRequest({
    method: 'POST',
    url: '/upload',
    body,
    config: { baseUrl: 'https://api.example.com' },
    options: signal ? { signal } : undefined,
  });
  return { request, signal: composedSignal, config: {}, uploadBytes: 6, onUpload };
}

describe('dispatch upload-progress fallback', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('streams directly and reports progress when the connection supports it — the common case', async () => {
    let calls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      calls++;
      const req = input as Request;
      if (req.body) await new Response(req.body).arrayBuffer();
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    const events: unknown[] = [];
    const ctx = contextForUpload((progress) => events.push(progress));

    await dispatch(ctx);

    expect(calls).toBe(1); // never needed a fallback
    expect(ctx.response?.status).toBe(200);
    expect(events.length).toBeGreaterThan(0);
  });

  it('defaults to total 0 when uploadBytes is omitted, in the streaming path', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const req = input as Request;
      if (req.body) await new Response(req.body).arrayBuffer();
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.close();
      },
    });
    const { request, signal } = normalizeRequest({
      method: 'POST',
      url: '/upload',
      body,
      config: { baseUrl: 'https://api.example.com' },
    });
    const ctx: FetchContext = { request, signal, config: {}, onUpload: () => {} }; // uploadBytes omitted

    await dispatch(ctx);

    expect(ctx.response?.status).toBe(200);
  });

  it('defaults to total 0 when uploadBytes is omitted, in the plain (no-streaming) path', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );

    const { request, signal } = normalizeRequest({
      method: 'GET',
      url: '/no-body',
      config: { baseUrl: 'https://api.example.com' },
    });
    const ctx: FetchContext = { request, signal, config: {}, onUpload: () => {} }; // uploadBytes omitted

    await dispatch(ctx);

    expect(ctx.response?.status).toBe(200);
  });

  it('sends directly (no streaming/fallback path) when onUpload is set but the request has no body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );

    const { request, signal } = normalizeRequest({
      method: 'GET',
      url: '/no-body',
      config: { baseUrl: 'https://api.example.com' },
    });
    const ctx: FetchContext = { request, signal, config: {}, uploadBytes: 0, onUpload: () => {} };

    await dispatch(ctx);

    expect(ctx.response?.status).toBe(200);
  });

  it('retries once, without streaming, when the streamed attempt fails before any byte is sent', async () => {
    let calls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      calls++;
      if (calls === 1) {
        // Simulates Chrome's net::ERR_ALPN_NEGOTIATION_FAILED: rejects without ever reading the body.
        throw new TypeError('Failed to fetch');
      }
      // Fallback attempt: consume the spare's body like a real fetch would, then succeed.
      const req = input as Request;
      if (req.body) await new Response(req.body).arrayBuffer();
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    const events: unknown[] = [];
    const ctx = contextForUpload((progress) => events.push(progress));

    await dispatch(ctx);

    expect(calls).toBe(2);
    expect(ctx.response?.status).toBe(200);
    // The fallback attempt is unstreamed by design — onUpload never fires for it, exactly like a
    // runtime that never claimed duplex support (Firefox) already behaves.
    expect(events).toEqual([]);
  });

  it('does not retry — and propagates a NetworkError — once at least one byte was already sent', async () => {
    let calls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      calls++;
      const req = input as Request;
      const reader = req.body!.getReader();
      await reader.read(); // pull at least one chunk through the progress TransformStream
      throw new TypeError('mid-transfer network failure');
    });

    const ctx = contextForUpload(() => {});

    await expect(dispatch(ctx)).rejects.toBeInstanceOf(NetworkError);
    expect(calls).toBe(1); // no silent retry once bytes may have reached the server
  });

  it('reports cancellation as CanceledError, with no fallback attempt, if the signal is aborted during the initial streamed attempt', async () => {
    const controller = new AbortController();
    let calls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      calls++;
      controller.abort('user stop');
      throw new TypeError('aborted');
    });

    const ctx = contextForUpload(() => {}, controller.signal);

    await expect(dispatch(ctx)).rejects.toBeInstanceOf(CanceledError);
    expect(calls).toBe(1); // a deliberate user cancellation is never followed by a silent retry
  });

  it('propagates a NetworkError from the fallback attempt itself when it also fails', async () => {
    let calls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      calls++;
      throw new TypeError(calls === 1 ? 'Failed to fetch' : 'fallback also failed');
    });

    const ctx = contextForUpload(() => {});

    await expect(dispatch(ctx)).rejects.toBeInstanceOf(NetworkError);
    expect(calls).toBe(2); // one streamed attempt + exactly one unstreamed fallback, no more
  });

  it('reports cancellation as CanceledError if the signal is aborted during the fallback attempt', async () => {
    const controller = new AbortController();
    let calls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      calls++;
      if (calls === 1) throw new TypeError('Failed to fetch'); // streamed attempt, nothing sent yet
      controller.abort('user stop'); // the user cancels exactly as the unstreamed fallback begins
      throw new TypeError('aborted mid-fallback');
    });

    const ctx = contextForUpload(() => {}, controller.signal);
    const pending = dispatch(ctx);

    await expect(pending).rejects.toBeInstanceOf(CanceledError);
    await expect(pending).rejects.toMatchObject({ reason: 'user stop' });
    expect(calls).toBe(2); // one streamed attempt + exactly one fallback attempt
  });
});
