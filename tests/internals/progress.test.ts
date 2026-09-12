import { afterEach, describe, expect, it, vi } from 'vitest';
import { withDownloadProgress, withUploadProgress } from '../../src/internals/progress';
import { TooLargeError } from '../../src/errors/TooLargeError';
import type { ProgressInfo } from '../../src/types/ProgressInfo';

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function chunkedStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i]));
        i++;
      } else {
        controller.close();
      }
    },
  });
}

describe('withDownloadProgress', () => {
  it('reports monotonically increasing progress/loaded and ends at 100%', async () => {
    const events: ProgressInfo[] = [];
    const body = chunkedStream(['a'.repeat(5), 'b'.repeat(5)]);
    const response = new Response(body, { headers: { 'Content-Length': '10' } });

    const wrapped = withDownloadProgress(response, (progress) => events.push(progress));
    const bytes = await readAll(wrapped.body!);

    expect(bytes.byteLength).toBe(10);
    expect(events.length).toBeGreaterThan(0);
    expect(events.at(-1)!.progress).toBe(1);
    expect(events.at(-1)!.loaded).toBe(10);
    for (let i = 1; i < events.length; i++) {
      expect(events[i].loaded).toBeGreaterThanOrEqual(events[i - 1].loaded);
    }
  });

  it('reports progress 0 throughout when Content-Length is absent, but still tracks loaded', async () => {
    const events: ProgressInfo[] = [];
    const body = chunkedStream(['xy']);
    const response = new Response(body);

    const wrapped = withDownloadProgress(response, (progress) => events.push(progress));
    await readAll(wrapped.body!);

    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.progress === 0 || e.progress === 1)).toBe(true);
    expect(events.at(-1)!.loaded).toBe(2);
  });

  it('handles extreme chunking — one byte per chunk — without losing any bytes', async () => {
    const events: ProgressInfo[] = [];
    const body = chunkedStream(['a', 'b', 'c', 'd', 'e']);
    const response = new Response(body, { headers: { 'Content-Length': '5' } });

    const wrapped = withDownloadProgress(response, (progress) => events.push(progress));
    const bytes = await readAll(wrapped.body!);

    expect(new TextDecoder().decode(bytes)).toBe('abcde');
    expect(events.at(-1)!.loaded).toBe(5);
  });

  it('passes through a response with no body untouched', () => {
    const response = new Response(null, { status: 204 });
    const wrapped = withDownloadProgress(response, () => {});
    expect(wrapped).toBe(response);
  });

  it('keeps intermediate progress at exactly 0 (not just the final flush) when the size is unknown', async () => {
    const events: ProgressInfo[] = [];
    const body = chunkedStream(['aaaaa', 'bbbbb', 'ccccc']);
    const response = new Response(body);

    const wrapped = withDownloadProgress(response, (progress) => events.push(progress));
    await readAll(wrapped.body!);

    // At least one event fires before the final flush (3 chunks → the delayed-publish pattern
    // reports the 1st chunk when the 2nd arrives, well before the stream ends).
    expect(events.length).toBeGreaterThan(1);
    for (const e of events.slice(0, -1)) expect(e.progress).toBe(0);
    expect(events.at(-1)!.progress).toBe(1);
  });

  it('clamps progress just under 1 mid-stream if total was underestimated, never reporting >1 before the end', async () => {
    const events: ProgressInfo[] = [];
    const body = chunkedStream(['a'.repeat(10), 'b'.repeat(10), 'c'.repeat(10)]);
    // Deliberately wrong (too small) Content-Length, e.g. a FormData size estimate that undershoots.
    const response = new Response(body, { headers: { 'Content-Length': '15' } });

    const wrapped = withDownloadProgress(response, (progress) => events.push(progress));
    await readAll(wrapped.body!);

    for (const e of events) expect(e.progress).toBeLessThanOrEqual(1);
    expect(events.some((e) => e.progress < 1)).toBe(true); // the clamp actually engaged before the end
    expect(events.at(-1)!.progress).toBe(1);
  });

  it('reports a single flush-only event at 100% for a completely empty body', async () => {
    const events: ProgressInfo[] = [];
    const response = new Response(chunkedStream([]));

    const wrapped = withDownloadProgress(response, (progress) => events.push(progress));
    await readAll(wrapped.body!);

    expect(events).toEqual([{ progress: 1, total: 0, loaded: 0 }]);
  });

  describe('rate/estimated', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('computes a constant rate and a linearly decreasing estimated for a steady transfer', async () => {
      // 3 chunks of 10 bytes each, 30 total. performance.now() sequence below makes each chunk
      // take exactly 2 (simulated) seconds, so the running-average rate stays constant at 5 B/s.
      vi.spyOn(performance, 'now')
        .mockReturnValueOnce(1000) // startTime, captured on chunk 1
        .mockReturnValueOnce(3000) // rateFields() call when chunk 1 is reported (chunk 2 arrives)
        .mockReturnValueOnce(5000) // ... chunk 2 reported (chunk 3 arrives)
        .mockReturnValueOnce(7000); // ... flush() — final chunk

      const events: ProgressInfo[] = [];
      const body = chunkedStream(['a'.repeat(10), 'b'.repeat(10), 'c'.repeat(10)]);
      const response = new Response(body, { headers: { 'Content-Length': '30' } });

      const wrapped = withDownloadProgress(response, (progress) => events.push(progress));
      await readAll(wrapped.body!);

      expect(events.map((e) => e.rate)).toEqual([5, 5, 5]);
      expect(events.map((e) => e.estimated)).toEqual([4, 2, 0]);
    });

    it('omits rate/estimated entirely when no measurable time has elapsed', async () => {
      vi.spyOn(performance, 'now').mockReturnValue(1000); // same instant, every call

      const events: ProgressInfo[] = [];
      const body = chunkedStream(['a'.repeat(10), 'b'.repeat(10)]);
      const response = new Response(body, { headers: { 'Content-Length': '20' } });

      const wrapped = withDownloadProgress(response, (progress) => events.push(progress));
      await readAll(wrapped.body!);

      expect(events.length).toBeGreaterThan(0);
      for (const e of events) {
        expect(e.rate).toBeUndefined();
        expect(e.estimated).toBeUndefined();
      }
    });

    it('omits estimated (but still reports rate) when total is unknown', async () => {
      vi.spyOn(performance, 'now').mockReturnValueOnce(1000).mockReturnValueOnce(2000).mockReturnValueOnce(3000);

      const events: ProgressInfo[] = [];
      const body = chunkedStream(['a'.repeat(10), 'b'.repeat(10)]);
      const response = new Response(body); // no Content-Length -> total unknown

      const wrapped = withDownloadProgress(response, (progress) => events.push(progress));
      await readAll(wrapped.body!);

      expect(events.length).toBeGreaterThan(0);
      for (const e of events) {
        expect(e.rate).toBeGreaterThan(0);
        expect(e.estimated).toBeUndefined();
      }
    });
  });

  it('passes through untouched when neither onProgress nor maxBytes is given', () => {
    const response = new Response(chunkedStream(['x']));
    const wrapped = withDownloadProgress(response);
    expect(wrapped).toBe(response);
  });

  describe('maxBytes', () => {
    it('lets a body within the limit through untouched', async () => {
      const response = new Response(chunkedStream(['a'.repeat(5), 'b'.repeat(5)]));
      const wrapped = withDownloadProgress(response, undefined, 10);
      const bytes = await readAll(wrapped.body!);
      expect(bytes.byteLength).toBe(10);
    });

    it('errors the stream with TooLargeError once real received bytes exceed the limit', async () => {
      const response = new Response(chunkedStream(['a'.repeat(5), 'b'.repeat(5), 'c'.repeat(5)]));
      const wrapped = withDownloadProgress(response, undefined, 8);

      const error = await readAll(wrapped.body!).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(TooLargeError);
      expect((error as TooLargeError).maxDownloadBytes).toBe(8);
      expect((error as TooLargeError).transferredBytes).toBeGreaterThan(8);
    });

    it('does not trust a lying Content-Length header — enforces the limit against real bytes', async () => {
      // Server declares a small Content-Length but actually sends more.
      const response = new Response(chunkedStream(['a'.repeat(20)]), { headers: { 'Content-Length': '1' } });
      const wrapped = withDownloadProgress(response, undefined, 8);

      await expect(readAll(wrapped.body!)).rejects.toBeInstanceOf(TooLargeError);
    });

    it('enforces the limit even when a progress callback is also registered', async () => {
      const events: ProgressInfo[] = [];
      // maxBytes sits between withDownloadProgress and withProgress — a cut-off on chunk N means
      // withProgress (which reports chunk N-1 only once chunk N arrives, per its delayed-publish
      // design) never sees chunk N at all. 4 chunks / cap after the 3rd leaves room for exactly
      // one onProgress call (for chunk 1, published when chunk 2 arrives) before the abort.
      const response = new Response(chunkedStream(['a'.repeat(5), 'b'.repeat(5), 'c'.repeat(5), 'd'.repeat(5)]), {
        headers: { 'Content-Length': '20' },
      });
      const wrapped = withDownloadProgress(response, (progress) => events.push(progress), 13);

      await expect(readAll(wrapped.body!)).rejects.toBeInstanceOf(TooLargeError);
      expect(events.length).toBe(1);
      expect(events[0].loaded).toBe(5);
    });
  });
});

describe('withUploadProgress', () => {
  it('reports progress while streaming a request body and preserves the content', async () => {
    const events: ProgressInfo[] = [];
    const body = chunkedStream(['hello ', 'world']);
    const request = new Request('https://api.example.com/x', {
      method: 'POST',
      body,
      duplex: 'half',
    } as RequestInit);

    const wrapped = withUploadProgress(request, 11, (progress) => events.push(progress));
    const text = new TextDecoder().decode(await readAll(wrapped.body!));

    expect(text).toBe('hello world');
    expect(events.at(-1)!.progress).toBe(1);
    expect(events.at(-1)!.loaded).toBe(11);
  });

  it('passes through a bodyless request untouched', () => {
    const request = new Request('https://api.example.com/x');
    const wrapped = withUploadProgress(request, 0, () => {});
    expect(wrapped).toBe(request);
  });

  it('calls onStart synchronously on the first chunk, before onProgress ever fires', async () => {
    const startOrder: string[] = [];
    const body = chunkedStream(['a', 'b']);
    const request = new Request('https://api.example.com/x', { method: 'POST', body, duplex: 'half' } as RequestInit);

    const wrapped = withUploadProgress(
      request,
      2,
      () => startOrder.push('progress'),
      () => startOrder.push('start'),
    );
    await readAll(wrapped.body!);

    expect(startOrder[0]).toBe('start');
  });

  it('never calls onStart when the request has no body to stream', () => {
    const request = new Request('https://api.example.com/x');
    let started = false;
    withUploadProgress(request, 0, () => {}, () => (started = true));
    expect(started).toBe(false);
  });
});
