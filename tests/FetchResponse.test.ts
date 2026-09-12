import { describe, expect, it } from 'vitest';
import { FetchResponse } from '../src/FetchResponse';

describe('FetchResponse', () => {
  it('delegates the metadata getters to the underlying Response', () => {
    const raw = new Response('body', {
      status: 201,
      statusText: 'Created',
      headers: { 'X-A': '1' },
    });
    const response = new FetchResponse(raw);

    expect(response.ok).toBe(true);
    expect(response.status).toBe(201);
    expect(response.statusText).toBe('Created');
    expect(response.headers.get('x-a')).toBe('1');
    expect(response.redirected).toBe(false);
    expect(response.body).toBe(raw.body);
    expect(response.url).toBe(raw.url);
    expect(response.type).toBe(raw.type);
  });

  it('tracks bodyUsed as the underlying Response does', async () => {
    const response = new FetchResponse(new Response('hello'));
    expect(response.bodyUsed).toBe(false);
    await response.text();
    expect(response.bodyUsed).toBe(true);
  });

  it('clones into an independently readable FetchResponse', async () => {
    const response = new FetchResponse(new Response('hello'));
    const cloned = response.clone();

    expect(cloned).toBeInstanceOf(FetchResponse);
    await expect(cloned.text()).resolves.toBe('hello');
    // Reading the clone must not disturb the original.
    expect(response.bodyUsed).toBe(false);
    await expect(response.text()).resolves.toBe('hello');
  });

  it('parses text', async () => {
    const response = new FetchResponse(new Response('hello'));
    await expect(response.text()).resolves.toBe('hello');
  });

  it('parses JSON with a generic type parameter', async () => {
    interface User {
      id: number;
    }
    const response = new FetchResponse(new Response(JSON.stringify({ id: 1 })));
    const user = await response.json<User>();
    expect(user.id).toBe(1);
  });

  it('parses arrayBuffer/blob/formData', async () => {
    const bufferResponse = new FetchResponse(new Response(new Uint8Array([1, 2, 3])));
    const buffer = await bufferResponse.arrayBuffer();
    expect(new Uint8Array(buffer)).toEqual(new Uint8Array([1, 2, 3]));

    const blobResponse = new FetchResponse(new Response('x'));
    expect((await blobResponse.blob()).size).toBe(1);

    const form = new FormData();
    form.append('a', '1');
    const formResponse = new FetchResponse(new Response(form));
    const parsedForm = await formResponse.formData();
    expect(parsedForm.get('a')).toBe('1');
  });

  it('parses bytes()', async () => {
    const response = new FetchResponse(new Response(new Uint8Array([1, 2, 3])));
    const bytes = await response.bytes();
    expect(bytes).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('falls back to arrayBuffer() for bytes() on a runtime without Response.prototype.bytes', async () => {
    const raw = new Response(new Uint8Array([4, 5, 6]));
    // Simulate an older runtime by shadowing the prototype method on this instance.
    Object.defineProperty(raw, 'bytes', { value: undefined });
    const response = new FetchResponse(raw);
    await expect(response.bytes()).resolves.toEqual(new Uint8Array([4, 5, 6]));
  });

  it("does not throw for a non-2xx status — throwOnError is the caller's responsibility", () => {
    const response = new FetchResponse(new Response(null, { status: 500 }));
    expect(response.ok).toBe(false);
    expect(response.status).toBe(500);
  });
});
