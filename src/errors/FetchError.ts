/** Base class for every error fetch-rig throws — catch this to handle any of them at once. */
export class FetchError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'FetchError';
  }
}
