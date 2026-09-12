import { describe, expect, it } from 'vitest';
import { supportsDuplex } from '../../src/internals/duplex-support';

describe('supportsDuplex', () => {
  it('is a boolean reflecting whether this runtime honors duplex: half', () => {
    expect(typeof supportsDuplex).toBe('boolean');
  });
});
