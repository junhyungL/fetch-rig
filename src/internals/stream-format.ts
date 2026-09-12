import type { StreamFormat } from '../types/StreamResponse';

// RFC 6839 structured syntax suffix — application/vnd.api+json, application/ld+json,
// application/problem+json, etc. are all JSON too. Requires `+json` to be followed by a
// parameter (`;...`) or the end of the string, so a subtype that merely contains "+json"
// elsewhere can't match by accident.
const JSON_SUFFIX_RE = /\+json(;|$)/;

/** Guesses the stream format from the response's Content-Type header — used for `format: 'auto'`. */
export function guessFormat(headers: Headers): Exclude<StreamFormat, 'auto'> {
  const contentType = headers.get('content-type')?.toLowerCase() ?? '';

  if (contentType.includes('text/event-stream')) return 'sse';
  if (
    contentType.includes('application/json') ||
    contentType.includes('application/x-ndjson') ||
    JSON_SUFFIX_RE.test(contentType)
  ) {
    return 'json';
  }
  return 'text';
}
