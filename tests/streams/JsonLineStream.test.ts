import { describe, expect, it } from 'vitest';
import { JsonLineStream } from '../../src/streams/JsonLineStream';
import { byCharacter, collect, stringSource } from './helpers';

describe('JsonLineStream', () => {
  it('parses a single JSON object', async () => {
    const values = await collect(stringSource(['{"a":1}']), new JsonLineStream());
    expect(values).toEqual([{ type: 'json', data: '{"a":1}' }]);
  });

  it('parses multiple values concatenated back to back (NDJSON)', async () => {
    const values = await collect(
      stringSource(['{"a":1}\n{"b":2}\n{"c":3}']),
      new JsonLineStream(),
    );
    expect(values.map((v) => v.data)).toEqual(['{"a":1}', '{"b":2}', '{"c":3}']);
  });

  it('does not miscount braces inside a string literal, including an escaped quote', async () => {
    const raw = String.raw`{"text":"a {brace} and \"quote\""}`;
    const values = await collect(stringSource([raw]), new JsonLineStream());
    expect(values).toEqual([{ type: 'json', data: raw }]);
    expect(JSON.parse(values[0].data)).toEqual({ text: 'a {brace} and "quote"' });
  });

  it('handles nested objects and arrays', async () => {
    const raw = '{"a":{"b":[1,2,{"c":3}]}}';
    const values = await collect(stringSource([raw]), new JsonLineStream());
    expect(values).toEqual([{ type: 'json', data: raw }]);
  });

  it('parses correctly when a value is split across many chunks', async () => {
    const values = await collect(
      stringSource(['{"a":', '1,"b":', '[1,2', ',3]}']),
      new JsonLineStream(),
    );
    expect(values).toEqual([{ type: 'json', data: '{"a":1,"b":[1,2,3]}' }]);
  });

  it('parses correctly when fed one character at a time (extreme chunking)', async () => {
    const values = await collect(byCharacter('{"x":1}{"y":2}'), new JsonLineStream());
    expect(values.map((v) => v.data)).toEqual(['{"x":1}', '{"y":2}']);
  });

  it('flushes a trailing value with no more data after it', async () => {
    const values = await collect(stringSource(['{"tail":true}']), new JsonLineStream());
    expect(values).toEqual([{ type: 'json', data: '{"tail":true}' }]);
  });

  it('emits nothing extra at flush when the buffer is already empty (all values consumed mid-stream)', async () => {
    const values = await collect(stringSource(['{"a":1}\n']), new JsonLineStream());
    expect(values).toEqual([{ type: 'json', data: '{"a":1}' }]);
  });

  it('yields a value with `error` set, instead of throwing or silently dropping it, on a parse failure', async () => {
    // Malformed JSON that still balances braces so the depth tracker treats it as "complete".
    const values = await collect(stringSource(['{"a": }']), new JsonLineStream());
    expect(values).toHaveLength(1);
    expect(values[0].data).toBe('{"a": }');
    expect(values[0].error).toBeInstanceOf(Error);
  });

  it('yields a truncated trailing fragment with `error` set when the stream ends mid-object', async () => {
    // Never closes — depth never returns to 0, so bufferJsonValues() never emits it during
    // transform() and it's still sitting in the buffer when flush() runs.
    const values = await collect(stringSource(['{"incomplete": "no closing brace"']), new JsonLineStream());
    expect(values).toHaveLength(1);
    expect(values[0].data).toBe('{"incomplete": "no closing brace"');
    expect(values[0].error).toBeInstanceOf(Error);
  });

  it('does not stream individual elements of a top-level JSON array — the whole array arrives as one value', async () => {
    const raw = '[{"a":1},{"b":2}]';
    const values = await collect(stringSource([raw]), new JsonLineStream());
    expect(values).toEqual([{ type: 'json', data: raw }]);
  });
});
