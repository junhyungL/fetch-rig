import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { fr } from '../src/index';
import { retry } from '../src/middleware/retry';
import { TooLargeError } from '../src/errors/TooLargeError';
import type { ProgressInfo } from '../src/types/ProgressInfo';

function chunkedBody(parts: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i < parts.length) {
        controller.enqueue(encoder.encode(parts[i]));
        i++;
      } else {
        controller.close();
      }
    },
  });
}

let downloadCalls = 0;

const server = setupServer(
  http.get('https://api.example.com/download', () => {
    const body = 'x'.repeat(20);
    return new HttpResponse(chunkedBody([body.slice(0, 10), body.slice(10)]), {
      headers: { 'Content-Length': '20' },
    });
  }),
  http.get('https://api.example.com/flaky-download', () => {
    downloadCalls++;
    if (downloadCalls < 2) {
      return HttpResponse.json({}, { status: 503, headers: { 'Retry-After': '0' } });
    }
    return new HttpResponse(chunkedBody(['ab', 'cd']), { headers: { 'Content-Length': '4' } });
  }),
  http.post('https://api.example.com/upload', async ({ request }) => {
    const text = await request.text();
    return HttpResponse.json({ length: text.length });
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  downloadCalls = 0;
});
afterAll(() => server.close());

describe('upload/download progress end to end', () => {
  it('reports download progress that reaches 100% and matches the body length', async () => {
    const events: ProgressInfo[] = [];
    const api = fr.create({ baseUrl: 'https://api.example.com' });

    const response = await api.get('/download', {
      onDownload: (progress) => events.push(progress),
    });
    const text = await response.text();

    expect(text).toHaveLength(20);
    expect(events.length).toBeGreaterThan(0);
    expect(events.at(-1)).toMatchObject({ progress: 1, loaded: 20 });
  });

  it('reports upload progress for a Blob body and the server receives the full content', async () => {
    const events: ProgressInfo[] = [];
    const api = fr.create({ baseUrl: 'https://api.example.com' });
    const blob = new Blob(['hello world']);

    const response = await api.post('/upload', blob, {
      onUpload: (progress) => events.push(progress),
    });

    await expect(response.json()).resolves.toEqual({ length: 11 });
    expect(events.length).toBeGreaterThan(0);
    expect(events.at(-1)).toMatchObject({ progress: 1, loaded: 11, total: 11 });
  });

  it('does not duplicate or carry over progress across a retried download', async () => {
    const events: ProgressInfo[] = [];
    const api = fr.create({ baseUrl: 'https://api.example.com', middlewares: [retry({ limit: 2 })] });

    const response = await api.get('/flaky-download', {
      onDownload: (progress) => events.push(progress),
    });

    expect(downloadCalls).toBe(2); // first attempt: 503 with no body; second: succeeds with a real body
    await expect(response.text()).resolves.toBe('abcd');
    // Only the successful attempt has a body to report progress on, so the final tally must
    // match that body exactly — not doubled by counting anything from the failed first attempt.
    expect(events.at(-1)).toMatchObject({ progress: 1, loaded: 4 });
  });

  describe('maxDownloadBytes', () => {
    it('applies as an instance-level default — api.get() itself still resolves; only reading the body rejects', async () => {
      // fetch() resolves once headers arrive, before the body is read — same for fetch-rig, so the
      // TooLargeError can only surface once something actually reads the response body.
      const api = fr.create({ baseUrl: 'https://api.example.com', maxDownloadBytes: 5 });
      const response = await api.get('/download');
      await expect(response.text()).rejects.toBeInstanceOf(TooLargeError);
    });

    it('lets a response within the limit through normally', async () => {
      const api = fr.create({ baseUrl: 'https://api.example.com', maxDownloadBytes: 1000 });
      const response = await api.get('/download');
      await expect(response.text()).resolves.toHaveLength(20);
    });

    it('a per-call value overrides the instance default in both directions', async () => {
      const api = fr.create({ baseUrl: 'https://api.example.com', maxDownloadBytes: 5 });

      // Per-call raises the limit high enough to let it through despite the strict instance default.
      const allowed = await api.get('/download', { maxDownloadBytes: 1000 });
      await expect(allowed.text()).resolves.toHaveLength(20);

      // Per-call can also tighten it below a lenient instance default.
      const api2 = fr.create({ baseUrl: 'https://api.example.com', maxDownloadBytes: 1000 });
      const blocked = await api2.get('/download', { maxDownloadBytes: 5 });
      await expect(blocked.text()).rejects.toBeInstanceOf(TooLargeError);
    });
  });
});
