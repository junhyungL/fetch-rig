import type { JsonStreamResponse } from '../types/StreamResponse';

/**
 * Extracts complete JSON values (objects/arrays) from a string buffer by tracking brace/bracket
 * depth character by character — escapes and braces/brackets inside a string literal are excluded
 * from the depth count. A value is complete each time depth returns to 0.
 *
 * Built for NDJSON (independent JSON values, one after another) — a response that's a single
 * top-level JSON array (`[{...},{...}]`) only emits once the whole array closes, not per element.
 */
function bufferJsonValues(text: string): { values: string[]; remainder: string } {
  const values: string[] = [];
  let current = '';
  let depth = 0;
  let inString = false;
  let escaped = false;
  let i = 0;

  while (i < text.length) {
    const char = text[i];

    if (depth < 1) {
      if (char === '{' || char === '[') {
        current += char;
        depth = 1;
        inString = false;
        escaped = false;
      }
      i++;
      continue;
    }

    current += char;

    if (escaped) {
      escaped = false;
      i++;
      continue;
    }
    if (char === '\\' && inString) {
      escaped = true;
      i++;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      i++;
      continue;
    }
    if (!inString) {
      if (char === '{' || char === '[') depth++;
      else if (char === '}' || char === ']') depth--;
    }

    if (depth === 0) {
      values.push(current.trim());
      current = '';
      inString = false;
      escaped = false;
    }

    i++;
  }

  return { values, remainder: current };
}

/**
 * Parses a `text/plain`/`application/x-ndjson` body into one {@link JsonStreamResponse} per JSON
 * value. A value that fails `JSON.parse` never breaks the stream or gets silently dropped — it's
 * enqueued with `error` set and `data` holding the raw, unparseable text, so one malformed line
 * can't block the rest of the NDJSON stream.
 */
export class JsonLineStream extends TransformStream<string, JsonStreamResponse> {
  constructor() {
    let buffer = '';

    const emit = (
      raw: string,
      controller: TransformStreamDefaultController<JsonStreamResponse>,
    ) => {
      try {
        JSON.parse(raw); // validity check only — the raw text is forwarded, not the parsed value
        controller.enqueue({ type: 'json', data: raw });
      } catch (error) {
        // JSON.parse always throws a real Error (SyntaxError) per spec, so the non-Error branch
        // here is unreachable in practice — kept only in case a future runtime/polyfill breaks
        // that contract, not because there's a real input that hits it.
        /* v8 ignore next */
        controller.enqueue({
          type: 'json',
          data: raw,
          error: error instanceof Error ? error : new Error(String(error)),
        });
      }
    };

    super({
      transform(chunk, controller) {
        buffer += chunk;
        const { values, remainder } = bufferJsonValues(buffer);
        buffer = remainder;
        for (const raw of values) emit(raw, controller);
      },
      flush(controller) {
        const raw = buffer.trim();
        if (raw) emit(raw, controller);
      },
    });
  }
}
