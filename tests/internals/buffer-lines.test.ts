import { describe, expect, it } from 'vitest';
import { bufferLines } from '../../src/internals/buffer-lines';

describe('bufferLines', () => {
  it('splits on \\n, \\r, and \\r\\n within a single buffer', () => {
    const { lines, remainder } = bufferLines('a\nb\rc\r\nd', false);
    expect(lines).toEqual(['a', 'b', 'c']);
    expect(remainder).toBe('d');
  });

  it('holds back a trailing lone \\r until more data arrives (CRLF split across chunks)', () => {
    const first = bufferLines('line1\r', false);
    expect(first.lines).toEqual([]);
    expect(first.remainder).toBe('line1\r'); // held back — could be CR or the start of CRLF

    const second = bufferLines(`${first.remainder}\nline2`, false);
    expect(second.lines).toEqual(['line1']); // resolved as CRLF once \n arrived
    expect(second.remainder).toBe('line2');
  });

  it('resolves a trailing lone \\r as a line terminator when isFinal is true', () => {
    const { lines, remainder } = bufferLines('line1\r', true);
    expect(lines).toEqual(['line1']);
    expect(remainder).toBe('');
  });

  it('leaves unterminated trailing text in remainder regardless of isFinal', () => {
    const { lines, remainder } = bufferLines('no newline here', true);
    expect(lines).toEqual([]);
    expect(remainder).toBe('no newline here');
  });

  it('handles a bare \\r not followed by \\n as its own line terminator', () => {
    const { lines, remainder } = bufferLines('a\rb', false);
    expect(lines).toEqual(['a']);
    expect(remainder).toBe('b');
  });

  it('handles an empty buffer', () => {
    expect(bufferLines('', false)).toEqual({ lines: [], remainder: '' });
    expect(bufferLines('', true)).toEqual({ lines: [], remainder: '' });
  });

  it('handles consecutive blank lines', () => {
    const { lines } = bufferLines('a\n\n\nb\n', false);
    expect(lines).toEqual(['a', '', '', 'b']);
  });
});
