/**
 * Pulls complete lines out of a string buffer, recognizing `\n`, `\r`, and `\r\n` alike. Shared
 * by `SseStream` and `TextLineStream`.
 *
 * The trick: when the buffer's *last* character is `\r`, there's no way to tell yet whether it's
 * a lone CR or the start of a CRLF split across a chunk boundary — so unless `isFinal`, that `\r`
 * is held back in `remainder` rather than resolved, until the next chunk (or end of stream)
 * settles it.
 */
export function bufferLines(
  buffer: string,
  isFinal: boolean,
): { lines: string[]; remainder: string } {
  const lines: string[] = [];
  let lineStart = 0;
  let i = 0;

  while (i < buffer.length) {
    const ch = buffer[i];
    if (ch === '\n') {
      lines.push(buffer.slice(lineStart, i));
      i += 1;
      lineStart = i;
    } else if (ch === '\r') {
      if (i + 1 < buffer.length) {
        const consumed = buffer[i + 1] === '\n' ? 2 : 1;
        lines.push(buffer.slice(lineStart, i));
        i += consumed;
        lineStart = i;
      } else if (isFinal) {
        lines.push(buffer.slice(lineStart, i));
        i += 1;
        lineStart = i;
      } else {
        break; // need the next chunk to tell a lone CR apart from CRLF
      }
    } else {
      i += 1;
    }
  }

  return { lines, remainder: buffer.slice(lineStart) };
}
