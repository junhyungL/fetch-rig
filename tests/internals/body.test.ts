import { describe, expect, it } from 'vitest';
import { getSize, isJsonSerializable, serialize } from '../../src/internals/body';

describe('isJsonSerializable', () => {
  it('accepts primitives, arrays, and plain objects', () => {
    expect(isJsonSerializable('x')).toBe(true);
    expect(isJsonSerializable(1)).toBe(true);
    expect(isJsonSerializable(true)).toBe(true);
    expect(isJsonSerializable(null)).toBe(true);
    expect(isJsonSerializable([1, 2])).toBe(true);
    expect(isJsonSerializable({ a: 1 })).toBe(true);
  });

  it('rejects undefined, Map/Set, FormData, URLSearchParams, and typed arrays', () => {
    expect(isJsonSerializable(undefined)).toBe(false);
    expect(isJsonSerializable(new Map([['a', 1]]))).toBe(false);
    expect(isJsonSerializable(new Set([1]))).toBe(false);
    expect(isJsonSerializable(new FormData())).toBe(false);
    expect(isJsonSerializable(new URLSearchParams())).toBe(false);
    expect(isJsonSerializable(new Uint8Array([1, 2]))).toBe(false);
  });

  it('rejects non-object primitives like bigint, function, and symbol', () => {
    expect(isJsonSerializable(10n)).toBe(false);
    expect(isJsonSerializable(() => {})).toBe(false);
    expect(isJsonSerializable(Symbol('x'))).toBe(false);
  });

  it('accepts a custom class only when it defines toJSON', () => {
    class Point {
      constructor(
        public x: number,
        public y: number,
      ) {}
    }
    expect(isJsonSerializable(new Point(1, 2))).toBe(false);

    class SerializablePoint {
      constructor(
        public x: number,
        public y: number,
      ) {}
      toJSON() {
        return { x: this.x, y: this.y };
      }
    }
    expect(isJsonSerializable(new SerializablePoint(1, 2))).toBe(true);
  });
});

describe('serialize', () => {
  it('passes FormData through untouched and strips any Content-Type (boundary must be runtime-generated)', () => {
    const form = new FormData();
    const result = serialize(form, undefined);
    expect(result.body).toBe(form);
    expect(result.contentType).toBeNull();
  });

  it('serializes URLSearchParams to a urlencoded string regardless of prior Content-Type', () => {
    const result = serialize(new URLSearchParams({ a: '1' }), undefined);
    expect(result.body).toBe('a=1');
    expect(result.contentType).toBe('application/x-www-form-urlencoded;charset=UTF-8');
  });

  it('passes a string body through untouched, preserving any existing Content-Type', () => {
    const result = serialize('raw text', 'text/csv');
    expect(result.body).toBe('raw text');
    expect(result.contentType).toBe('text/csv');
  });

  it('stringifies a non-object primitive body (e.g. a number) as text/plain', () => {
    const result = serialize(42, undefined);
    expect(result.body).toBe('42');
    expect(result.contentType).toBe('text/plain;charset=UTF-8');
  });

  it('defaults a plain object to JSON when no Content-Type hint is present', () => {
    const result = serialize({ a: 1 }, undefined);
    expect(result.body).toBe('{"a":1}');
    expect(result.contentType).toBe('application/json;charset=UTF-8');
  });

  it('respects an explicit application/x-www-form-urlencoded hint for a plain object', () => {
    const result = serialize({ a: '1', b: '2' }, 'application/x-www-form-urlencoded');
    expect(result.body).toBe('a=1&b=2');
    expect(result.contentType).toBe('application/x-www-form-urlencoded');
  });

  it('respects an explicit multipart/form-data hint for a plain object and clears the boundary-less header', () => {
    const result = serialize({ a: '1' }, 'multipart/form-data');
    expect(result.body).toBeInstanceOf(FormData);
    expect(result.contentType).toBeNull();
  });

  it('does not misclassify a Map as JSON — passes it through instead of silently stringifying to "{}"', () => {
    const map = new Map([['a', 1]]);
    const result = serialize(map, undefined);
    expect(result.body).toBe(map);
  });

  it('never sets a Content-Type for Blob/ReadableStream — lets the runtime decide', () => {
    expect(serialize(new Blob(['x']), undefined).contentType).toBeUndefined();
    expect(serialize(new ReadableStream(), undefined).contentType).toBeUndefined();
  });

  it('defaults binary bodies to application/octet-stream', () => {
    expect(serialize(new ArrayBuffer(4), undefined).contentType).toBe('application/octet-stream');
    expect(serialize(new Uint8Array(4), undefined).contentType).toBe('application/octet-stream');
  });
});

describe('getSize', () => {
  it('returns 0 for no body', () => {
    expect(getSize(undefined)).toBe(0);
  });

  it('sizes a string as its UTF-8 byte length', () => {
    expect(getSize('hello')).toBe(5);
    expect(getSize('héllo')).toBe(6); // é is 2 bytes in UTF-8
  });

  it('sizes a Blob directly', () => {
    expect(getSize(new Blob(['abc']))).toBe(3);
  });

  it('sizes ArrayBuffer and typed array views', () => {
    expect(getSize(new ArrayBuffer(10))).toBe(10);
    expect(getSize(new Uint8Array(7))).toBe(7);
  });

  it('sizes URLSearchParams as its encoded string form', () => {
    const params = new URLSearchParams({ a: '1' });
    expect(getSize(params)).toBe(params.toString().length);
  });

  it('returns 0 for a ReadableStream (unknowable ahead of time)', () => {
    expect(getSize(new ReadableStream())).toBe(0);
  });

  it('estimates FormData size including field content', () => {
    const form = new FormData();
    form.append('a', 'hello');
    const size = getSize(form);
    expect(size).toBeGreaterThan('hello'.length); // includes boundary/header overhead
  });

  it('sizes a File/Blob field in FormData by its byte size, not string length', () => {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(1000)]), 'x.bin');
    expect(getSize(form)).toBeGreaterThanOrEqual(1000);
  });
});
