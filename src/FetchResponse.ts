import { toIterator } from './internals/stream-iterator';
import { guessFormat } from './internals/stream-format';
import { JsonLineStream } from './streams/JsonLineStream';
import { SseStream } from './streams/SseStream';
import { TextLineStream } from './streams/TextLineStream';
import type {
  JsonStreamResponse,
  SseStreamResponse,
  StreamOptions,
  StreamResponse,
  TextStreamResponse,
} from './types/StreamResponse';

/**
 * A pure wrapper around fetch's `Response`. `throwOnError` is not decided here — whether to
 * throw an `HTTPError` for a non-2xx status is `FetchInstance`'s (the caller's) responsibility.
 */
export class FetchResponse {
  readonly #response: Response;

  constructor(response: Response) {
    this.#response = response;
  }

  get ok(): boolean {
    return this.#response.ok;
  }

  get status(): number {
    return this.#response.status;
  }

  get statusText(): string {
    return this.#response.statusText;
  }

  get headers(): Headers {
    return this.#response.headers;
  }

  get url(): string {
    return this.#response.url;
  }

  get redirected(): boolean {
    return this.#response.redirected;
  }

  get type(): ResponseType {
    return this.#response.type;
  }

  /** The raw body stream, used by streaming response handling (see `stream()` below). */
  get body(): ReadableStream<Uint8Array> | null {
    return this.#response.body;
  }

  /** True once any body-reading method (or `stream()`) has been called — a body can only be read once. */
  get bodyUsed(): boolean {
    return this.#response.bodyUsed;
  }

  /** Same one-clone-before-first-read rule as native `Response.clone()` — call it before reading the body if you need to read it more than once. */
  clone(): FetchResponse {
    return new FetchResponse(this.#response.clone());
  }

  text(): Promise<string> {
    return this.#response.text();
  }

  json<T>(): Promise<T> {
    return this.#response.json() as Promise<T>;
  }

  arrayBuffer(): Promise<ArrayBuffer> {
    return this.#response.arrayBuffer();
  }

  blob(): Promise<Blob> {
    return this.#response.blob();
  }

  formData(): Promise<FormData> {
    return this.#response.formData();
  }

  /** `Response.prototype.bytes()` is a fairly recent addition, so its availability is feature-detected. */
  async bytes(): Promise<Uint8Array> {
    if (typeof this.#response.bytes === 'function') {
      return this.#response.bytes();
    }
    return new Uint8Array(await this.#response.arrayBuffer());
  }

  /**
   * Parses the response body as a stream of {@link StreamResponse} values: decode → parse,
   * chained via `pipeThrough()`. Breaking out of a `for await` loop midway still propagates
   * cancellation upstream, all the way to the network connection, via `toIterator()`'s
   * `reader.cancel()`.
   *
   * @param options.format - Defaults to `'auto'`, detected from the Content-Type header.
   */
  stream(options?: StreamOptions): AsyncGenerator<StreamResponse> {
    if (!this.#response.body) {
      throw new Error('fetch-rig: this response has no body to stream.');
    }

    const format = !options?.format || options.format === 'auto' ? guessFormat(this.#response.headers) : options.format;
    const decoded = this.#response.body.pipeThrough(new TextDecoderStream());
    const parsed: ReadableStream<StreamResponse> =
      format === 'sse'
        ? decoded.pipeThrough(new SseStream())
        : format === 'json'
          ? decoded.pipeThrough(new JsonLineStream())
          : decoded.pipeThrough(new TextLineStream());

    return toIterator(parsed);
  }

  /** Shorthand for `stream({ format: 'sse' })`. */
  streamAsSse(): AsyncGenerator<SseStreamResponse> {
    return this.stream({ format: 'sse' }) as AsyncGenerator<SseStreamResponse>;
  }

  /** Shorthand for `stream({ format: 'json' })` — parses the body as NDJSON regardless of Content-Type. */
  streamAsJson(): AsyncGenerator<JsonStreamResponse> {
    return this.stream({ format: 'json' }) as AsyncGenerator<JsonStreamResponse>;
  }

  /** Shorthand for `stream({ format: 'text' })`. */
  streamAsText(): AsyncGenerator<TextStreamResponse> {
    return this.stream({ format: 'text' }) as AsyncGenerator<TextStreamResponse>;
  }
}
