/** 문자열 청크 배열을 순서대로 흘려보내는 ReadableStream<string>을 만든다. */
export function stringSource(chunks: string[]): ReadableStream<string> {
  let i = 0;
  return new ReadableStream<string>({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(chunks[i]);
        i++;
      } else {
        controller.close();
      }
    },
  });
}

/** TransformStream 하나를 문자열 청크로 돌려서 출력 전부를 배열로 모은다. */
export async function collect<T>(
  source: ReadableStream<string>,
  transform: TransformStream<string, T>,
): Promise<T[]> {
  const reader = source.pipeThrough(transform).getReader();
  const results: T[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    results.push(value);
  }
  return results;
}

/** 문자열을 한 글자씩(극단적 청크 분할) 흘려보내는 소스를 만든다. */
export function byCharacter(text: string): ReadableStream<string> {
  return stringSource(Array.from(text));
}
