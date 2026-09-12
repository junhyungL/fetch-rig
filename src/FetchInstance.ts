import { HTTPError } from './errors/HTTPError';
import { FetchResponse } from './FetchResponse';
import { compose } from './middleware/compose';
import { dispatch } from './internals/dispatch';
import { normalizeRequest } from './internals/normalize-request';
import type { FetchConfig } from './types/FetchConfig';
import type { FetchRequest } from './types/FetchRequest';
import type { Dispatch, FetchContext } from './types/Middleware';
import type { RequestOptions } from './types/RequestOptions';

/**
 * The public API's actual implementation. `fr` (exported below) is just one instance of this
 * class created with an empty config, and `fr.create(config)` creates a new one — there's no
 * separate static namespace object.
 */
export class FetchInstance {
  readonly #config: FetchConfig;
  readonly #dispatch: Dispatch;

  constructor(config: FetchConfig = {}) {
    this.#config = config;
    this.#dispatch = compose(config.middlewares ?? [], dispatch);
  }

  /** Creates a new, independently-configured instance — does not inherit `this`'s config. */
  create(config: FetchConfig = {}): FetchInstance {
    return new FetchInstance(config);
  }

  get(url: string, options?: RequestOptions): Promise<FetchResponse> {
    return this.send({ method: 'GET', url, ...options });
  }

  head(url: string, options?: RequestOptions): Promise<FetchResponse> {
    return this.send({ method: 'HEAD', url, ...options });
  }

  delete(url: string, options?: RequestOptions): Promise<FetchResponse> {
    return this.send({ method: 'DELETE', url, ...options });
  }

  options(url: string, options?: RequestOptions): Promise<FetchResponse> {
    return this.send({ method: 'OPTIONS', url, ...options });
  }

  /** `body` is auto-serialized based on its type and any explicit Content-Type — see {@link RequestOptions}. */
  post(url: string, body?: unknown, options?: RequestOptions): Promise<FetchResponse> {
    return this.send({ method: 'POST', url, body, ...options });
  }

  put(url: string, body?: unknown, options?: RequestOptions): Promise<FetchResponse> {
    return this.send({ method: 'PUT', url, body, ...options });
  }

  patch(url: string, body?: unknown, options?: RequestOptions): Promise<FetchResponse> {
    return this.send({ method: 'PATCH', url, body, ...options });
  }

  /** The primitive every verb method above calls into. Use it directly for a dynamic method. */
  async send(request: FetchRequest): Promise<FetchResponse> {
    const { method, url, body, ...options } = request;
    const {
      request: normalizedRequest,
      signal,
      uploadBytes,
    } = normalizeRequest({
      method,
      url,
      body,
      config: this.#config,
      options,
    });
    const ctx: FetchContext = {
      request: normalizedRequest,
      signal,
      config: this.#config,
      uploadBytes,
      onUpload: options.onUpload,
      onDownload: options.onDownload,
      maxDownloadBytes: options.maxDownloadBytes ?? this.#config.maxDownloadBytes,
    };

    await this.#dispatch(ctx);

    if (!ctx.response) {
      // dispatch() always sets ctx.response or throws — reaching here means a user middleware
      // short-circuited without calling next() or setting a response of its own.
      throw new Error('fetch-rig: the middleware chain completed without producing a response.');
    }

    const throwOnError = options.throwOnError ?? this.#config.throwOnError ?? false;
    const shouldThrow =
      typeof throwOnError === 'function'
        ? throwOnError(ctx.response.status)
        : throwOnError && !ctx.response.ok;
    if (shouldThrow) {
      throw await HTTPError.from(ctx.response, ctx.request);
    }

    return new FetchResponse(ctx.response);
  }
}

/**
 * A `FetchInstance` created with an empty config — not a separate static namespace object.
 * `fr.get(...)` is just a method call on this default instance, and `fr.create(config)`
 * creates a new scoped instance.
 */
export const fr: FetchInstance = new FetchInstance();
