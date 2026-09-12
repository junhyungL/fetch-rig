import { bufferLines } from '../internals/buffer-lines';
import type { SseStreamResponse } from '../types/StreamResponse';

// DoS guard cap (characters) against an unterminated line growing without bound. Not exposed as
// a public option — an internal safety net that could be made configurable later, if ever needed.
const MAX_BUFFER_SIZE = 10 * 1024 * 1024;

interface DraftEvent {
  event: string;
  data: string;
  id?: string;
  retry?: number;
  hasData: boolean;
}

function createDraftEvent(): DraftEvent {
  return { event: 'message', data: '', hasData: false };
}

function toEvent(draft: DraftEvent): SseStreamResponse {
  return { type: 'sse', event: draft.event, data: draft.data, id: draft.id, retry: draft.retry };
}

/** Parses one line as a field and applies it to `draft`, per the WHATWG SSE spec. */
function parseField(line: string, draft: DraftEvent): void {
  if (line.startsWith(':')) return; // comment line — ignored

  const colonIndex = line.indexOf(':');
  let field: string;
  let value: string;
  if (colonIndex === -1) {
    field = line;
    value = '';
  } else {
    field = line.slice(0, colonIndex);
    const raw = line.slice(colonIndex + 1);
    value = raw.startsWith(' ') ? raw.slice(1) : raw; // strip exactly one leading space after the colon
  }

  switch (field) {
    case 'event':
      draft.event = value;
      break;
    case 'data':
      // Joins each data line with \n — equivalent to the spec's "append each line + \n, then
      // strip the final \n" result.
      draft.data = draft.hasData ? `${draft.data}\n${value}` : value;
      draft.hasData = true;
      break;
    case 'id':
      if (!value.includes('\0')) draft.id = value; // ignored if it contains a NULL character (spec)
      break;
    case 'retry':
      if (/^\d+$/.test(value)) draft.retry = Number(value); // only accepted if entirely digits (spec)
      break;
    default:
      break; // unrecognized field — ignored
  }
}

/**
 * Parses `text/event-stream` (SSE) into {@link SseStreamResponse} values, via a line-streaming
 * state machine ported from eventsource-parser. BOM stripping isn't handled here — the upstream
 * `TextDecoderStream` already does it (its default `ignoreBOM: false`).
 */
export class SseStream extends TransformStream<string, SseStreamResponse> {
  constructor() {
    let buffer = '';
    let draft = createDraftEvent();

    const consumeLines = (
      lines: string[],
      controller: TransformStreamDefaultController<SseStreamResponse>,
    ) => {
      for (const line of lines) {
        if (line === '') {
          if (draft.hasData) controller.enqueue(toEvent(draft));
          draft = createDraftEvent();
        } else {
          parseField(line, draft);
        }
      }
    };

    super({
      transform(chunk, controller) {
        buffer += chunk;
        if (buffer.length > MAX_BUFFER_SIZE) {
          controller.error(
            new Error(
              `SSE stream: buffered data exceeded ${MAX_BUFFER_SIZE} characters without a line terminator.`,
            ),
          );
          return;
        }
        const { lines, remainder } = bufferLines(buffer, false);
        buffer = remainder;
        consumeLines(lines, controller);
      },
      flush(controller) {
        const { lines, remainder } = bufferLines(buffer, true);
        // Unlike a real EventSource, fetch()'s body has a definite end — so an unterminated
        // trailing text is still treated as one final field line and processed.
        consumeLines(remainder ? [...lines, remainder] : lines, controller);
        if (draft.hasData) controller.enqueue(toEvent(draft));
      },
    });
  }
}
