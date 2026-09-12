/** One parsed Server-Sent Event, yielded by `streamAsSse()`. */
export interface SseStreamResponse {
  type: 'sse';
  event: string;
  data: string;
  id?: string;
  retry?: number;
}

/**
 * `data` is the raw text of one complete JSON value — whether/how to parse it is up to the
 * consumer (`JSON.parse(event.data)`). `error` is set (and `data` holds the raw, unparseable
 * text) instead of throwing or silently dropping the value when it fails to parse as JSON.
 */
export interface JsonStreamResponse {
  type: 'json';
  data: string;
  error?: Error;
}

/** One line of plain text, yielded by `streamAsText()`. */
export interface TextStreamResponse {
  type: 'text';
  data: string;
}

/** The value yielded by `FetchResponse.stream()`, discriminated by `type`. */
export type StreamResponse = SseStreamResponse | JsonStreamResponse | TextStreamResponse;

export type StreamFormat = 'sse' | 'json' | 'text' | 'auto';

export interface StreamOptions {
  /** Default 'auto' — auto-detected from the Content-Type header. */
  format?: StreamFormat;
}
