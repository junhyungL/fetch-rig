import { describe, expect, it } from 'vitest';
import { SseStream } from '../../src/streams/SseStream';
import { byCharacter, collect, stringSource } from './helpers';

describe('SseStream', () => {
  it('parses a basic event with default event type "message"', async () => {
    const events = await collect(stringSource(['data: hello\n\n']), new SseStream());
    expect(events).toEqual([
      { type: 'sse', event: 'message', data: 'hello', id: undefined, retry: undefined },
    ]);
  });

  it('treats a colon-less line as a field name with an empty value', async () => {
    // Per spec, a line with no ':' at all is the whole line as the field name, value "".
    // "data" alone (no colon) still counts as a data field, dispatching an event with data: "".
    const events = await collect(stringSource(['data\n\n']), new SseStream());
    expect(events).toEqual([
      { type: 'sse', event: 'message', data: '', id: undefined, retry: undefined },
    ]);
  });

  it('silently ignores unrecognized field names', async () => {
    const events = await collect(stringSource(['foo: bar\ndata: x\n\n']), new SseStream());
    expect(events).toEqual([
      { type: 'sse', event: 'message', data: 'x', id: undefined, retry: undefined },
    ]);
  });

  it('parses a named event with id and retry', async () => {
    const events = await collect(
      stringSource(['event: update\nid: 42\nretry: 3000\ndata: payload\n\n']),
      new SseStream(),
    );
    expect(events).toEqual([
      { type: 'sse', event: 'update', data: 'payload', id: '42', retry: 3000 },
    ]);
  });

  it('joins multiple data lines with \\n', async () => {
    const events = await collect(stringSource(['data: line1\ndata: line2\n\n']), new SseStream());
    expect(events[0].data).toBe('line1\nline2');
  });

  it('ignores comment lines (starting with :)', async () => {
    const events = await collect(
      stringSource([': this is a comment\ndata: x\n\n']),
      new SseStream(),
    );
    expect(events).toEqual([
      { type: 'sse', event: 'message', data: 'x', id: undefined, retry: undefined },
    ]);
  });

  it('dispatches an event with empty data (heartbeat-style)', async () => {
    const events = await collect(stringSource(['data:\n\n']), new SseStream());
    expect(events).toEqual([
      { type: 'sse', event: 'message', data: '', id: undefined, retry: undefined },
    ]);
  });

  it('does not dispatch a block with no data field at all', async () => {
    const events = await collect(stringSource(['event: ping\n\n']), new SseStream());
    expect(events).toEqual([]);
  });

  it('ignores an id field that contains a NULL character', async () => {
    const events = await collect(stringSource([`id: bad\0id\ndata: x\n\n`]), new SseStream());
    expect(events[0].id).toBeUndefined();
  });

  it('rejects a retry value that is not entirely digits', async () => {
    const events = await collect(stringSource(['retry: 10abc\ndata: x\n\n']), new SseStream());
    expect(events[0].retry).toBeUndefined();
  });

  it('accepts a retry value that is entirely digits', async () => {
    const events = await collect(stringSource(['retry: 500\ndata: x\n\n']), new SseStream());
    expect(events[0].retry).toBe(500);
  });

  it('parses multiple events separated by blank lines within one chunk', async () => {
    const events = await collect(
      stringSource(['data: a\n\ndata: b\n\ndata: c\n\n']),
      new SseStream(),
    );
    expect(events.map((e) => e.data)).toEqual(['a', 'b', 'c']);
  });

  it('parses correctly when an event is split across many chunks', async () => {
    const events = await collect(
      stringSource(['ev', 'ent: up', 'date\nda', 'ta: hel', 'lo\n', '\n']),
      new SseStream(),
    );
    expect(events).toEqual([
      { type: 'sse', event: 'update', data: 'hello', id: undefined, retry: undefined },
    ]);
  });

  it('parses correctly when fed one character at a time (extreme chunking)', async () => {
    const events = await collect(byCharacter('event: e\ndata: d\n\n'), new SseStream());
    expect(events).toEqual([
      { type: 'sse', event: 'e', data: 'd', id: undefined, retry: undefined },
    ]);
  });

  it('handles CRLF, CR, and LF line terminators identically', async () => {
    for (const eol of ['\n', '\r', '\r\n']) {
      const events = await collect(stringSource([`data: x${eol}${eol}`]), new SseStream());
      expect(events).toEqual([
        { type: 'sse', event: 'message', data: 'x', id: undefined, retry: undefined },
      ]);
    }
  });

  it('handles a CRLF blank-line separator split exactly across a chunk boundary', async () => {
    // "data: x\r\n\r\n" split right after the first \r — this is the case that requires
    // bufferLines() to hold back a trailing lone \r until the next chunk arrives.
    const events = await collect(stringSource(['data: x\r', '\n\r\n']), new SseStream());
    expect(events).toEqual([
      { type: 'sse', event: 'message', data: 'x', id: undefined, retry: undefined },
    ]);
  });

  it('flushes a pending event even without a trailing blank line at stream end', async () => {
    const events = await collect(stringSource(['data: tail']), new SseStream());
    expect(events).toEqual([
      { type: 'sse', event: 'message', data: 'tail', id: undefined, retry: undefined },
    ]);
  });

  it('errors the stream if an unterminated line grows past the internal DoS-guard buffer cap', async () => {
    // A single line with no terminator that keeps growing forever (e.g. a misbehaving or
    // malicious server) must not be buffered without limit.
    const huge = 'x'.repeat(11 * 1024 * 1024); // > 10MB internal cap, still no newline
    const reader = stringSource([huge]).pipeThrough(new SseStream()).getReader();
    await expect(reader.read()).rejects.toThrow(/exceeded/);
  });
});
