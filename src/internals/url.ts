import type { QueryInit, QueryValue } from '../types/Query';

export interface UrlParts {
  baseUrl?: string;
  path?: string;
  query?: QueryInit;
}

const ABSOLUTE_URL_RE = /^[a-z][a-z\d+\-.]*:\/\//i;

function withTrailingSlash(input: string): string {
  return input.endsWith('/') ? input : `${input}/`;
}

function withoutLeadingSlash(input: string): string {
  return input.startsWith('/') ? input.slice(1) : input;
}

/** ufo's `joinURL` algorithm — pure string joining, no dependency on browser-only APIs like `globalThis.location`. */
function joinPath(base: string, path?: string): string {
  if (!path) return base;
  if (!base) return path;
  return withTrailingSlash(base) + withoutLeadingSlash(path);
}

function splitQuery(input: string): [base: string, query: string] {
  const index = input.indexOf('?');
  return index === -1 ? [input, ''] : [input.slice(0, index), input.slice(index + 1)];
}

/** An array query value serializes as a repeated key (`key=v1&key=v2`), matching http-client/ufo/axios's default convention. */
export function stringifyQuery(query?: QueryInit): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    const values: QueryValue[] = Array.isArray(value) ? value : [value];
    for (const v of values) {
      if (v !== undefined) params.append(key, String(v));
    }
  }
  return params.toString();
}

/**
 * Builds the final URL string for a request.
 *
 * Returns a string, not a `URL` object — a relative `baseUrl` (e.g. `'/api'`) can't be turned
 * into a `URL` without an origin, but `fetch()`/`Request` accept a plain string URL as-is, so
 * there's no need to force one. If a relative URL is actually fetched in Node, letting that fail
 * there is the correct behavior (it resolves fine in a browser, against the page's origin).
 *
 * An absolute `path` bypasses `baseUrl` entirely — otherwise `api.get('https://other.com/x')`
 * would get the instance's `baseUrl` wrongly prepended to an already-complete URL (the same rule
 * ky/ofetch follow: an absolute input bypasses baseUrl).
 */
export function buildUrl({ baseUrl, path, query }: UrlParts): string {
  const joined =
    path !== undefined && ABSOLUTE_URL_RE.test(path) ? path : joinPath(baseUrl ?? '', path);
  if (!joined) {
    throw new Error('A base URL or path is required to build a request URL.');
  }

  const [base, inlineQuery] = splitQuery(joined);
  const extraQuery = stringifyQuery(query);
  const combinedQuery = [inlineQuery, extraQuery].filter(Boolean).join('&');
  return combinedQuery ? `${base}?${combinedQuery}` : base;
}
