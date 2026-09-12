import { FetchError } from './FetchError';

/** Thrown when an `AbortSignal` is aborted. `reason` is carried over verbatim from `signal.reason`. */
export class CanceledError extends FetchError {
  readonly reason: unknown;

  constructor(reason?: unknown) {
    super(reasonToMessage(reason), { cause: reason });
    this.name = 'CanceledError';
    this.reason = reason;
  }
}

function reasonToMessage(reason: unknown): string {
  if (typeof reason === 'string') return reason;
  if (reason instanceof Error) return reason.message;
  return 'The request was canceled.';
}
