import { describe, expect, it } from 'vitest';
import { sleep } from '../../src/internals/sleep';

describe('sleep', () => {
  it('resolves after the given delay', async () => {
    const start = Date.now();
    await sleep(20);
    expect(Date.now() - start).toBeGreaterThanOrEqual(15);
  });

  it('rejects immediately if the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort('stop');
    await expect(sleep(1000, controller.signal)).rejects.toBe('stop');
  });

  it('rejects as soon as the signal aborts mid-wait, without waiting out the full delay', async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort('stop'), 10);
    const start = Date.now();
    await expect(sleep(10_000, controller.signal)).rejects.toBe('stop');
    expect(Date.now() - start).toBeLessThan(1000);
  });
});
