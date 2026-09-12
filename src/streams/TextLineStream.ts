import { bufferLines } from '../internals/buffer-lines';
import type { TextStreamResponse } from '../types/StreamResponse';

/** Splits plain text into lines, yielding one {@link TextStreamResponse} per line. */
export class TextLineStream extends TransformStream<string, TextStreamResponse> {
  constructor() {
    let buffer = '';

    super({
      transform(chunk, controller) {
        buffer += chunk;
        const { lines, remainder } = bufferLines(buffer, false);
        buffer = remainder;
        for (const line of lines) {
          controller.enqueue({ type: 'text', data: line });
        }
      },
      flush(controller) {
        const { lines, remainder } = bufferLines(buffer, true);
        for (const line of lines) {
          controller.enqueue({ type: 'text', data: line });
        }
        if (remainder) {
          controller.enqueue({ type: 'text', data: remainder });
        }
      },
    });
  }
}
