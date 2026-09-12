import { describe, expect, it } from 'vitest';
import { buildUrl, stringifyQuery } from '../../src/internals/url';

describe('buildUrl', () => {
  it('joins an absolute baseUrl and path without duplicating slashes', () => {
    expect(buildUrl({ baseUrl: 'https://api.example.com/', path: '/users' })).toBe(
      'https://api.example.com/users',
    );
    expect(buildUrl({ baseUrl: 'https://api.example.com', path: 'users' })).toBe(
      'https://api.example.com/users',
    );
  });

  it('works with a relative baseUrl without touching globalThis.location (Node has none)', () => {
    expect(globalThis.location).toBeUndefined();
    expect(buildUrl({ baseUrl: '/api', path: '/users' })).toBe('/api/users');
  });

  it('bypasses baseUrl entirely when path is itself an absolute URL', () => {
    expect(buildUrl({ baseUrl: 'https://api.example.com', path: 'https://other.com/x' })).toBe(
      'https://other.com/x',
    );
  });

  it('serializes array query values as repeated keys', () => {
    expect(
      buildUrl({ baseUrl: 'https://api.example.com', path: '/users', query: { tag: ['a', 'b'] } }),
    ).toBe('https://api.example.com/users?tag=a&tag=b');
  });

  it('merges an inline query string on path with the structured query option', () => {
    expect(
      buildUrl({
        baseUrl: 'https://api.example.com',
        path: '/users?active=true',
        query: { page: 2 },
      }),
    ).toBe('https://api.example.com/users?active=true&page=2');
  });

  it('drops undefined query values', () => {
    expect(
      buildUrl({ baseUrl: 'https://api.example.com', path: '/x', query: { a: 1, b: undefined } }),
    ).toBe('https://api.example.com/x?a=1');
  });

  it('throws when neither baseUrl nor path is given', () => {
    expect(() => buildUrl({})).toThrow();
  });

  it('uses path as-is when there is no baseUrl to join it with', () => {
    expect(buildUrl({ path: '/x' })).toBe('/x');
  });
});

describe('stringifyQuery', () => {
  it('returns an empty string for no query', () => {
    expect(stringifyQuery(undefined)).toBe('');
    expect(stringifyQuery({})).toBe('');
  });
});
