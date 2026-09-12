import { FetchError } from './FetchError';

/** Thrown when a request is aborted for exceeding the `timeout` option. */
export class TimeoutError extends FetchError {
  readonly request: Request;

  constructor(request: Request) {
    super(`Request timed out: ${request.method} ${request.url}`);
    this.name = 'TimeoutError';
    this.request = request;
  }
}
