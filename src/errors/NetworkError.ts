import { FetchError } from './FetchError';

/** Thrown when `fetch()` itself rejects (DNS/connection failure, etc. — not a cancellation). */
export class NetworkError extends FetchError {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : 'The network request failed.', { cause });
    this.name = 'NetworkError';
  }
}
