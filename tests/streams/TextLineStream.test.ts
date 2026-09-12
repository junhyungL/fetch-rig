import { describe, expect, it } from 'vitest';
import { TextLineStream } from '../../src/streams/TextLineStream';
import { byCharacter, collect, stringSource } from './helpers';

describe('TextLineStream', () => {
  it('splits on newlines', async () => {
    const values = await collect(stringSource(['a\nb\nc']), new TextLineStream());
    expect(values).toEqual([
      { type: 'text', data: 'a' },
      { type: 'text', data: 'b' },
      { type: 'text', data: 'c' },
    ]);
  });

  it('emits the final unterminated line at stream end', async () => {
    const values = await collect(stringSource(['a\nb']), new TextLineStream());
    expect(values.map((v) => v.data)).toEqual(['a', 'b']);
  });

  it('does not emit a trailing empty string when the input ends with a newline', async () => {
    const values = await collect(stringSource(['a\nb\n']), new TextLineStream());
    expect(values.map((v) => v.data)).toEqual(['a', 'b']);
  });

  it('handles a line split across multiple chunks', async () => {
    const values = await collect(stringSource(['hel', 'lo wor', 'ld\n']), new TextLineStream());
    expect(values.map((v) => v.data)).toEqual(['hello world']);
  });

  it('handles one character at a time (extreme chunking)', async () => {
    const values = await collect(byCharacter('foo\nbar\n'), new TextLineStream());
    expect(values.map((v) => v.data)).toEqual(['foo', 'bar']);
  });

  it('handles a CRLF line ending split exactly at the \\r/\\n boundary across chunks', async () => {
    const values = await collect(stringSource(['line1\r', '\nline2']), new TextLineStream());
    expect(values.map((v) => v.data)).toEqual(['line1', 'line2']);
  });

  it('preserves empty lines', async () => {
    const values = await collect(stringSource(['a\n\nb\n']), new TextLineStream());
    expect(values.map((v) => v.data)).toEqual(['a', '', 'b']);
  });

  it('resolves a trailing lone \\r with no following \\n as a line terminator at stream end', async () => {
    const values = await collect(stringSource(['line1\r']), new TextLineStream());
    expect(values.map((v) => v.data)).toEqual(['line1']);
  });
});
