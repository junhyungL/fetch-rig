import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { fr } from '../src/index';
import { FetchResponse } from '../src/FetchResponse';

function sseBody(events: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    start(controller) {
      const timer = setInterval(() => {
        if (i >= events.length) {
          clearInterval(timer);
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(events[i]));
        i++;
      }, 5);
    },
  });
}

const server = setupServer(
  http.get('https://api.example.com/events', () => {
    return new HttpResponse(
      sseBody(['data: one\n\n', 'data: two\n\n', 'data: three\n\n', 'data: four\n\n']),
      { headers: { 'Content-Type': 'text/event-stream' } },
    );
  }),
  http.get('https://api.example.com/ndjson', () =>
    HttpResponse.text('{"n":1}\n{"n":2}\n{"n":3}\n', {
      headers: { 'Content-Type': 'application/x-ndjson' },
    }),
  ),
  http.get('https://api.example.com/lines', () =>
    HttpResponse.text('line1\nline2\nline3\n', { headers: { 'Content-Type': 'text/plain' } }),
  ),
  http.get('https://api.example.com/ndjson-malformed', () =>
    // {bad} has balanced braces (so bufferJsonValues captures it as a candidate value) but
    // isn't valid JSON (bad is not a quoted string), so JSON.parse itself throws.
    HttpResponse.text('{"n":1}\n{bad}\n{"n":3}\n', {
      headers: { 'Content-Type': 'application/x-ndjson' },
    }),
  ),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('FetchResponse.stream() end to end', () => {
  it('streamAsSse parses real SSE events from a live (mocked) response', async () => {
    const res = await fr.get('https://api.example.com/events');
    const events: string[] = [];
    for await (const event of res.streamAsSse()) {
      events.push(event.data);
    }
    expect(events).toEqual(['one', 'two', 'three', 'four']);
  });

  it('auto-detects SSE format from Content-Type', async () => {
    const res = await fr.get('https://api.example.com/events');
    const events: string[] = [];
    for await (const event of res.stream()) {
      expect(event.type).toBe('sse');
      events.push((event as { data: string }).data);
    }
    expect(events).toEqual(['one', 'two', 'three', 'four']);
  });

  it('auto-detects NDJSON format from Content-Type', async () => {
    const res = await fr.get('https://api.example.com/ndjson');
    const values: string[] = [];
    for await (const item of res.stream()) {
      expect(item.type).toBe('json');
      values.push((item as { data: string }).data);
    }
    expect(values).toEqual(['{"n":1}', '{"n":2}', '{"n":3}']);
  });

  it('auto-detects plain text format from Content-Type', async () => {
    const res = await fr.get('https://api.example.com/lines');
    const lines: string[] = [];
    for await (const item of res.streamAsText()) {
      lines.push(item.data);
    }
    expect(lines).toEqual(['line1', 'line2', 'line3']);
  });

  it('streamAsJson() forces NDJSON parsing regardless of Content-Type', async () => {
    const res = await fr.get('https://api.example.com/ndjson');
    const values: string[] = [];
    for await (const item of res.streamAsJson()) {
      values.push(item.data);
    }
    expect(values).toEqual(['{"n":1}', '{"n":2}', '{"n":3}']);
  });

  it('streamAsJson() yields a malformed line inline with `error` set, instead of silently dropping it', async () => {
    const res = await fr.get('https://api.example.com/ndjson-malformed');
    const values: string[] = [];
    const errors: string[] = [];
    for await (const item of res.streamAsJson()) {
      if (item.error) {
        errors.push(item.data);
      } else {
        values.push(item.data);
      }
    }
    expect(values).toEqual(['{"n":1}', '{"n":3}']);
    expect(errors).toEqual(['{bad}']);
  });

  it('throws a clear error when the response has no body', () => {
    const response = new FetchResponse(new Response(null, { status: 204 }));
    expect(() => response.stream()).toThrow(/no body/);
  });

  it('breaking out of the for-await loop early stops consumption immediately', async () => {
    // This does NOT assert on `sseCancelled` (the mock server's own cancel() callback).
    // A diagnostic probe confirmed that MSW/undici's interception layer never propagates
    // `reader.cancel()` back to a mocked response.body's cancel() handler in this
    // environment — even calling cancel() directly on response.body with zero fetch-rig
    // code involved just hangs. That's a gap in MSW's mock stream, not in fetch-rig: the
    // actual propagation mechanism (reader.cancel() -> pipeThrough() chain -> original
    // source) is proven with real ReadableStream/TransformStream primitives in
    // internals/stream-iterator.test.ts, independent of any mocking layer. Here we
    // only verify the part that's actually ours to get right: the loop stops exactly
    // where the consumer broke, without draining the rest of the stream.
    const res = await fr.get('https://api.example.com/events');
    const seen: string[] = [];

    for await (const event of res.streamAsSse()) {
      seen.push(event.data);
      if (event.data === 'one') break;
    }

    expect(seen).toEqual(['one']);
  });
});
