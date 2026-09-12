/**
 * The library's single point of contact with `ReadableStreamDefaultReader`.
 *
 * When a consumer `break`s out of a `for await` loop midway, the async generator's `.return()`
 * propagates down to this function's `finally`, which calls `reader.cancel()`. It's `cancel()`
 * rather than `releaseLock()` on purpose: `cancel()` propagates upstream through a `pipeThrough()`
 * chain all the way to `response.body` and the network connection, while `releaseLock()` doesn't.
 * Getting this one function right means no other stream ever has to worry about reader cleanup.
 */
export async function* toIterator<T>(readable: ReadableStream<T>): AsyncGenerator<T> {
  const reader = readable.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    await reader.cancel();
  }
}
