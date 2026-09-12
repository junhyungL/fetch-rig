import { describe, expect, it } from 'vitest';
import { FetchError } from '../../src/errors/FetchError';
import { CanceledError } from '../../src/errors/CanceledError';
import { NetworkError } from '../../src/errors/NetworkError';
import { TimeoutError } from '../../src/errors/TimeoutError';
import { TooLargeError } from '../../src/errors/TooLargeError';

describe('FetchError hierarchy', () => {
  it('all subclasses are instanceof FetchError and Error', () => {
    const canceled = new CanceledError('nope');
    const network = new NetworkError(new Error('boom'));
    const timeout = new TimeoutError(new Request('https://api.example.com'));
    const tooLarge = new TooLargeError(1024, 2048);

    for (const error of [canceled, network, timeout, tooLarge]) {
      expect(error).toBeInstanceOf(FetchError);
      expect(error).toBeInstanceOf(Error);
    }
  });

  it('CanceledError carries signal.reason verbatim', () => {
    const controller = new AbortController();
    controller.abort('user cancelled');
    const error = new CanceledError(controller.signal.reason);
    expect(error.reason).toBe('user cancelled');
    expect(error.message).toBe('user cancelled');
  });

  it('CanceledError uses an Error reason\'s message, and falls back to a generic message otherwise', () => {
    const fromError = new CanceledError(new Error('boom'));
    expect(fromError.message).toBe('boom');

    const fromNothing = new CanceledError(undefined);
    expect(fromNothing.message).toBe('The request was canceled.');
  });

  it('NetworkError uses the cause error message, and falls back to a generic message for a non-Error cause', () => {
    const fromError = new NetworkError(new TypeError('fetch failed'));
    expect(fromError.message).toBe('fetch failed');
    expect(fromError.cause).toBeInstanceOf(TypeError);

    const fromString = new NetworkError('some raw failure');
    expect(fromString.message).toBe('The network request failed.');
    expect(fromString.cause).toBe('some raw failure');
  });

  it('TimeoutError carries the request that timed out', () => {
    const request = new Request('https://api.example.com/slow');
    const error = new TimeoutError(request);
    expect(error.request).toBe(request);
    expect(error.message).toContain('https://api.example.com/slow');
  });

  it('TooLargeError carries the limit and how much was actually received', () => {
    const error = new TooLargeError(1024, 2048);
    expect(error.maxDownloadBytes).toBe(1024);
    expect(error.transferredBytes).toBe(2048);
    expect(error.message).toContain('1024');
    expect(error.message).toContain('2048');
  });
});
