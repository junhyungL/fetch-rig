import { describe, expect, it } from 'vitest';
import { guessFormat } from '../../src/internals/stream-format';

describe('guessFormat', () => {
  it('detects SSE from text/event-stream', () => {
    expect(guessFormat(new Headers({ 'Content-Type': 'text/event-stream' }))).toBe('sse');
  });

  it('detects JSON from application/json and application/x-ndjson', () => {
    expect(guessFormat(new Headers({ 'Content-Type': 'application/json' }))).toBe('json');
    expect(guessFormat(new Headers({ 'Content-Type': 'application/x-ndjson' }))).toBe('json');
  });

  it('detects JSON from a +json structured syntax suffix (RFC 6839)', () => {
    expect(guessFormat(new Headers({ 'Content-Type': 'application/vnd.api+json' }))).toBe('json');
    expect(guessFormat(new Headers({ 'Content-Type': 'application/ld+json' }))).toBe('json');
    expect(guessFormat(new Headers({ 'Content-Type': 'application/problem+json; charset=utf-8' }))).toBe('json');
  });

  it('does not treat an unrelated subtype that merely contains "json" as a +json suffix', () => {
    expect(guessFormat(new Headers({ 'Content-Type': 'application/x-my-json-thing' }))).toBe('text');
  });

  it('falls back to text for anything else, including a missing Content-Type', () => {
    expect(guessFormat(new Headers({ 'Content-Type': 'text/plain' }))).toBe('text');
    expect(guessFormat(new Headers())).toBe('text');
  });
});
