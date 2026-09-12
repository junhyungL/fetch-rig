import { FetchError } from './FetchError';

/** Thrown when a response body exceeds the configured `maxDownloadBytes` limit. */
export class TooLargeError extends FetchError {
  readonly maxDownloadBytes: number;
  readonly transferredBytes: number;

  constructor(maxDownloadBytes: number, transferredBytes: number) {
    super(`Response exceeded the ${maxDownloadBytes}-byte maxDownloadBytes limit (received at least ${transferredBytes} bytes).`);
    this.name = 'TooLargeError';
    this.maxDownloadBytes = maxDownloadBytes;
    this.transferredBytes = transferredBytes;
  }
}
