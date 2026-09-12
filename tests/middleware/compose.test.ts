import { describe, expect, it } from 'vitest';
import { compose } from '../../src/middleware/compose';
import type { Dispatch, FetchContext, FetchMiddleware } from '../../src/types/Middleware';

function createContext(): FetchContext {
  return {
    request: new Request('https://api.example.com/x'),
    signal: new AbortController().signal,
    config: {},
  };
}

describe('compose', () => {
  it('runs middlewares in onion order: request phase in registration order, response phase in reverse', async () => {
    const log: string[] = [];
    const makeMiddleware = (name: string): FetchMiddleware => (next) => async (ctx) => {
      log.push(`${name}:before`);
      await next(ctx);
      log.push(`${name}:after`);
    };

    const core: Dispatch = async () => {
      log.push('core');
    };

    const dispatch = compose([makeMiddleware('a'), makeMiddleware('b'), makeMiddleware('c')], core);
    await dispatch(createContext());

    expect(log).toEqual(['a:before', 'b:before', 'c:before', 'core', 'c:after', 'b:after', 'a:after']);
  });

  it('lets a single middleware call next() multiple times (retry-like usage)', async () => {
    let coreCalls = 0;
    const core: Dispatch = async (ctx) => {
      coreCalls++;
      ctx.response = new Response(null, { status: coreCalls < 3 ? 500 : 200 });
    };

    const retryLike: FetchMiddleware = (next) => async (ctx) => {
      for (let attempt = 0; attempt < 5; attempt++) {
        await next(ctx);
        if (ctx.response?.status === 200) return;
      }
    };

    const dispatch = compose([retryLike], core);
    const ctx = createContext();
    await dispatch(ctx);

    expect(coreCalls).toBe(3);
    expect(ctx.response?.status).toBe(200);
  });

  it('lets a middleware call next() twice non-consecutively (auth-refresh-then-retry usage)', async () => {
    const calls: number[] = [];
    let n = 0;
    const core: Dispatch = async (ctx) => {
      n++;
      calls.push(n);
      ctx.response = new Response(null, { status: n === 1 ? 401 : 200 });
    };

    const authLike: FetchMiddleware = (next) => async (ctx) => {
      await next(ctx);
      if (ctx.response?.status === 401) {
        await next(ctx);
      }
    };

    const dispatch = compose([authLike], core);
    const ctx = createContext();
    await dispatch(ctx);

    expect(calls).toEqual([1, 2]);
    expect(ctx.response?.status).toBe(200);
  });

  it('does not require a middleware to call next() at all (short-circuiting is legitimate)', async () => {
    let coreCalled = false;
    const core: Dispatch = async () => {
      coreCalled = true;
    };
    const shortCircuit: FetchMiddleware = () => async (ctx) => {
      ctx.response = new Response(null, { status: 304 });
    };

    const dispatch = compose([shortCircuit], core);
    const ctx = createContext();
    await dispatch(ctx);

    expect(coreCalled).toBe(false);
    expect(ctx.response?.status).toBe(304);
  });

  it('propagates errors thrown by the core past any outer middleware', async () => {
    const core: Dispatch = async () => {
      throw new Error('core failure');
    };
    const passthrough: FetchMiddleware = (next) => (ctx) => next(ctx);

    const dispatch = compose([passthrough], core);
    await expect(dispatch(createContext())).rejects.toThrow('core failure');
  });

  it('composes an empty middleware list down to just the core', async () => {
    let called = false;
    const core: Dispatch = async () => {
      called = true;
    };
    await compose([], core)(createContext());
    expect(called).toBe(true);
  });
});
