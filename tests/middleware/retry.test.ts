import { afterEach, describe, expect, it, vi } from 'vitest';
import { compose } from '../../src/middleware/compose';
import { retry } from '../../src/middleware/retry';
import { CanceledError } from '../../src/errors/CanceledError';
import { NetworkError } from '../../src/errors/NetworkError';
import type { Dispatch, FetchContext } from '../../src/types/Middleware';

function createContext(request: Request, signal?: AbortSignal): FetchContext {
  return { request, signal: signal ?? new AbortController().signal, config: {} };
}

// Fast options so tests don't spend real wall-clock time on backoff.
const fastOptions = { minTimeout: 1, maxTimeout: 5, factor: 2 };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('retry', () => {
  it('retries on a retryable status code up to the limit, then returns the last response', async () => {
    let calls = 0;
    const core: Dispatch = async (ctx) => {
      calls++;
      ctx.response = new Response(null, { status: 500 });
    };

    const dispatch = compose([retry({ ...fastOptions, limit: 2 })], core);
    const ctx = createContext(new Request('https://api.example.com/x'));
    await dispatch(ctx);

    expect(calls).toBe(3); // 1 initial attempt + 2 retries
    expect(ctx.response?.status).toBe(500);
  });

  it('stops retrying as soon as a non-retryable status comes back', async () => {
    let calls = 0;
    const core: Dispatch = async (ctx) => {
      calls++;
      ctx.response = new Response(null, { status: calls < 2 ? 500 : 200 });
    };

    const dispatch = compose([retry({ ...fastOptions, limit: 5 })], core);
    const ctx = createContext(new Request('https://api.example.com/x'));
    await dispatch(ctx);

    expect(calls).toBe(2);
    expect(ctx.response?.status).toBe(200);
  });

  it('does not retry non-idempotent methods (POST) by default', async () => {
    let calls = 0;
    const core: Dispatch = async (ctx) => {
      calls++;
      ctx.response = new Response(null, { status: 500 });
    };

    const dispatch = compose([retry(fastOptions)], core);
    const ctx = createContext(new Request('https://api.example.com/x', { method: 'POST' }));
    await dispatch(ctx);

    expect(calls).toBe(1);
  });

  it('does not retry a CanceledError by default, even with attempts remaining', async () => {
    const core: Dispatch = async () => {
      throw new CanceledError('user cancelled');
    };

    const dispatch = compose([retry({ ...fastOptions, limit: 5 })], core);
    await expect(dispatch(createContext(new Request('https://api.example.com/x')))).rejects.toBeInstanceOf(
      CanceledError,
    );
  });

  it('retries a NetworkError by default', async () => {
    let calls = 0;
    const core: Dispatch = async (ctx) => {
      calls++;
      if (calls < 2) throw new NetworkError(new Error('boom'));
      ctx.response = new Response(null, { status: 200 });
    };

    const dispatch = compose([retry(fastOptions)], core);
    const ctx = createContext(new Request('https://api.example.com/x'));
    await dispatch(ctx);

    expect(calls).toBe(2);
    expect(ctx.response?.status).toBe(200);
  });

  it('lets shouldRetry override the default CanceledError exclusion', async () => {
    let calls = 0;
    const core: Dispatch = async (ctx) => {
      calls++;
      if (calls < 2) throw new CanceledError('retry me anyway');
      ctx.response = new Response(null, { status: 200 });
    };

    const dispatch = compose(
      [retry({ ...fastOptions, shouldRetry: () => true })],
      core,
    );
    const ctx = createContext(new Request('https://api.example.com/x'));
    await dispatch(ctx);

    expect(calls).toBe(2);
  });

  it('calls onFailedAttempt with an increasing attempt count', async () => {
    const attempts: number[] = [];
    let calls = 0;
    const core: Dispatch = async (ctx) => {
      calls++;
      ctx.response = new Response(null, { status: calls < 3 ? 500 : 200 });
    };

    const dispatch = compose(
      [retry({ ...fastOptions, onFailedAttempt: ({ attempt }) => attempts.push(attempt) })],
      core,
    );
    await dispatch(createContext(new Request('https://api.example.com/x')));

    expect(attempts).toEqual([1, 2]);
  });

  it('resends a streaming request body intact on every retry (clone-before-send)', async () => {
    const seenBodies: string[] = [];
    let calls = 0;
    const core: Dispatch = async (ctx) => {
      calls++;
      seenBodies.push(await ctx.request.text());
      ctx.response = new Response(null, { status: calls < 3 ? 500 : 200 });
    };

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('payload'));
        controller.close();
      },
    });
    const request = new Request('https://api.example.com/x', {
      method: 'PUT',
      body: stream,
      duplex: 'half',
    } as RequestInit);

    const dispatch = compose([retry(fastOptions)], core);
    await dispatch(createContext(request));

    expect(calls).toBe(3);
    expect(seenBodies).toEqual(['payload', 'payload', 'payload']);
  });

  it('skips cloning entirely once no retries remain (retry.limit: 0)', async () => {
    const cloneSpy = vi.spyOn(Request.prototype, 'clone');
    const core: Dispatch = async (ctx) => {
      ctx.response = new Response(null, { status: 500 });
    };

    const dispatch = compose([retry({ ...fastOptions, limit: 0 })], core);
    await dispatch(createContext(new Request('https://api.example.com/x')));

    expect(cloneSpy).not.toHaveBeenCalled();
  });

  it('honors the Retry-After header over the computed backoff', async () => {
    let calls = 0;
    const core: Dispatch = async (ctx) => {
      calls++;
      ctx.response = new Response(null, {
        status: 503,
        headers: calls === 1 ? { 'Retry-After': '0' } : undefined,
      });
    };

    const start = Date.now();
    // minTimeout is huge so if Retry-After weren't honored this would take much longer.
    const dispatch = compose([retry({ minTimeout: 5000, limit: 1 })], core);
    await dispatch(createContext(new Request('https://api.example.com/x')));

    expect(Date.now() - start).toBeLessThan(1000);
    expect(calls).toBe(2);
  });

  it('applies full jitter (0..delay) when jitter: true, without breaking the retry', async () => {
    let calls = 0;
    const core: Dispatch = async (ctx) => {
      calls++;
      ctx.response = new Response(null, { status: calls < 2 ? 500 : 200 });
    };

    const dispatch = compose([retry({ ...fastOptions, limit: 1, jitter: true })], core);
    await dispatch(createContext(new Request('https://api.example.com/x')));

    expect(calls).toBe(2);
  });

  it('uses a custom jitter function\'s return value for the delay', async () => {
    let calls = 0;
    const core: Dispatch = async (ctx) => {
      calls++;
      ctx.response = new Response(null, { status: calls < 2 ? 500 : 200 });
    };

    const start = Date.now();
    // minTimeout is huge; a custom jitter collapsing it to ~0 proves the function's
    // return value (not the computed backoff) is what's actually used.
    const dispatch = compose([retry({ minTimeout: 5000, limit: 1, jitter: () => 0 })], core);
    await dispatch(createContext(new Request('https://api.example.com/x')));

    expect(Date.now() - start).toBeLessThan(1000);
    expect(calls).toBe(2);
  });

  it('falls back to the computed delay when a custom jitter function returns an invalid value', async () => {
    let calls = 0;
    const core: Dispatch = async (ctx) => {
      calls++;
      ctx.response = new Response(null, { status: calls < 2 ? 500 : 200 });
    };

    const dispatch = compose(
      [retry({ ...fastOptions, limit: 1, jitter: () => Number.NaN })],
      core,
    );
    await dispatch(createContext(new Request('https://api.example.com/x')));

    expect(calls).toBe(2); // still completes — invalid jitter value didn't break the retry
  });
});
