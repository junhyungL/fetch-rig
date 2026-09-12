import { describe, expect, it } from 'vitest';
import { HTTPError } from '../../src/errors/HTTPError';

describe('HTTPError.from', () => {
  it('reads the body into `data` while leaving `response` re-readable', async () => {
    const response = new Response(JSON.stringify({ message: 'not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
    const request = new Request('https://api.example.com/x');

    const error = await HTTPError.from(response, request);

    expect(error.data).toEqual({ message: 'not found' });
    // `data` was read from a clone, so the original response body must still be consumable.
    await expect(error.response.json()).resolves.toEqual({ message: 'not found' });
  });

  it('falls back to raw text when the body is not valid JSON', async () => {
    const response = new Response('plain text error', { status: 500 });
    const request = new Request('https://api.example.com/x');

    const error = await HTTPError.from(response, request);

    expect(error.data).toBe('plain text error');
  });

  it('leaves `data` undefined for an empty body', async () => {
    const response = new Response(null, { status: 204 });
    const request = new Request('https://api.example.com/x');

    const error = await HTTPError.from(response, request);

    expect(error.data).toBeUndefined();
  });

  it('leaves `data` undefined, without throwing, when reading the cloned body itself fails', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error('connection reset mid-body'));
      },
    });
    const response = new Response(body, { status: 500 });
    const request = new Request('https://api.example.com/x');

    const error = await HTTPError.from(response, request);

    expect(error.data).toBeUndefined();
  });

  it('carries the status in the message', async () => {
    const response = new Response(null, { status: 503, statusText: 'Service Unavailable' });
    const request = new Request('https://api.example.com/x', { method: 'POST' });

    const error = await HTTPError.from(response, request);

    expect(error.message).toContain('503');
    expect(error.message).toContain('POST');
  });
});
