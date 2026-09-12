import { describe, expect, it, vi } from 'vitest';

// Isolated in its own file: vi.mock is hoisted and applies file-wide, and every other test in
// the suite needs the *real* supportsDuplex (this Node runtime genuinely supports it) — vitest
// gives each test file its own module registry by default, so this mock can't leak out.
vi.mock('../../src/internals/duplex-support', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/internals/duplex-support')>();
  return { ...actual, supportsDuplex: false };
});

describe('normalizeRequest on a runtime that does not support streaming request bodies', () => {
  it(
    'never sets duplex — proven indirectly, since Request has no public duplex getter to inspect: ' +
      'constructing a Request with a streaming body and no duplex option throws per the Fetch spec',
    async () => {
      const { normalizeRequest } = await import('../../src/internals/normalize-request');
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.close();
        },
      });

      expect(() =>
        normalizeRequest({
          method: 'POST',
          url: '/x',
          body: stream,
          config: { baseUrl: 'https://api.example.com' },
        }),
      ).toThrow();
    },
  );
});
