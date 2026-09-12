import { describe, expect, it } from 'vitest';

describe('scaffold', () => {
  it('runs in a Node environment with native fetch primitives available', () => {
    expect(typeof fetch).toBe('function');
    expect(typeof Request).toBe('function');
    expect(typeof Response).toBe('function');
    expect(typeof AbortController).toBe('function');
    expect(typeof TransformStream).toBe('function');
    expect(typeof AbortSignal.any).toBe('function');
    expect(typeof AbortSignal.timeout).toBe('function');
  });
});
