import { FetchError } from './FetchError';

/**
 * Thrown when `throwOnError: true` and the response is non-2xx.
 *
 * Built via {@link HTTPError.from} rather than the constructor because reading the body for
 * `data` is async. It reads a clone, so `error.response` itself stays fully re-readable.
 */
export class HTTPError extends FetchError {
  readonly response: Response;
  readonly request: Request;
  /** The response body, pre-read — the parsed value if it's valid JSON, otherwise the raw text, or undefined if there's no body. */
  readonly data: unknown;

  constructor(response: Response, request: Request, data?: unknown) {
    super(`Request failed with status ${response.status}: ${request.method} ${request.url}`);
    this.name = 'HTTPError';
    this.response = response;
    this.request = request;
    this.data = data;
  }

  /**
   * Builds an `HTTPError`, pre-reading `response`'s body into `data`.
   * @param response - The non-2xx response, read via a clone.
   * @param request - The request that produced it.
   */
  static async from(response: Response, request: Request): Promise<HTTPError> {
    const data = await readBodySafely(response.clone());
    return new HTTPError(response, request, data);
  }
}

async function readBodySafely(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => undefined);
  if (text === undefined || text === '') return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
