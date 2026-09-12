import { describe, expect, it } from 'vitest';
import { toIterator } from '../../src/internals/stream-iterator';

function trackedStream(values: number[]): {
  stream: ReadableStream<number>;
  cancelReason: { value: unknown; called: boolean };
} {
  const cancelReason = { value: undefined as unknown, called: false };
  let i = 0;
  const stream = new ReadableStream<number>({
    pull(controller) {
      if (i < values.length) {
        controller.enqueue(values[i]);
        i++;
      } else {
        controller.close();
      }
    },
    cancel(reason) {
      cancelReason.called = true;
      cancelReason.value = reason;
    },
  });
  return { stream, cancelReason };
}

describe('toIterator', () => {
  it('yields every value in order and reaches the end normally', async () => {
    const { stream } = trackedStream([1, 2, 3]);
    const results: number[] = [];
    for await (const value of toIterator(stream)) {
      results.push(value);
    }
    expect(results).toEqual([1, 2, 3]);
  });

  it('does not call cancel() when the consumer reads to completion', async () => {
    const { stream, cancelReason } = trackedStream([1, 2]);
    for await (const _ of toIterator(stream)) {
      // drain normally
    }
    expect(cancelReason.called).toBe(false);
  });

  it('calls reader.cancel() when the consumer breaks out early, propagating upstream', async () => {
    const { stream, cancelReason } = trackedStream([1, 2, 3, 4, 5]);
    const results: number[] = [];
    for await (const value of toIterator(stream)) {
      results.push(value);
      if (value === 2) break;
    }
    expect(results).toEqual([1, 2]);
    expect(cancelReason.called).toBe(true);
  });

  it('propagates cancellation through a pipeThrough() chain to the original source', async () => {
    const { stream: source, cancelReason } = trackedStream([1, 2, 3, 4, 5]);
    const passthrough = source.pipeThrough(
      new TransformStream<number, number>({
        transform(chunk, controller) {
          controller.enqueue(chunk);
        },
      }),
    );

    const results: number[] = [];
    for await (const value of toIterator(passthrough)) {
      results.push(value);
      if (value === 1) break;
    }

    expect(results).toEqual([1]);
    // Cancelling the readable end of a pipeThrough() chain must propagate back to the
    // original source's own cancel() — this is what makes an early `break` on
    // response.stream() actually stop the underlying network read.
    expect(cancelReason.called).toBe(true);
  });

  it('still calls cancel() when the consumer throws instead of breaking', async () => {
    const { stream, cancelReason } = trackedStream([1, 2, 3]);
    await expect(
      (async () => {
        for await (const value of toIterator(stream)) {
          if (value === 1) throw new Error('boom');
        }
      })(),
    ).rejects.toThrow('boom');
    expect(cancelReason.called).toBe(true);
  });
});
