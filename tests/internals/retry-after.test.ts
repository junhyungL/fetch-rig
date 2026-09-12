import { describe, expect, it, vi } from 'vitest';
import { parseRetryAfter } from '../../src/internals/retry-after';

function headersWith(retryAfter: string): Headers {
  return new Headers({ 'Retry-After': retryAfter });
}

describe('parseRetryAfter', () => {
  it('returns undefined when the header is absent', () => {
    expect(parseRetryAfter(new Headers())).toBeUndefined();
  });

  it('parses delay-seconds', () => {
    expect(parseRetryAfter(headersWith('120'))).toBe(120_000);
    expect(parseRetryAfter(headersWith('0'))).toBe(0);
  });

  it('returns undefined instead of Infinity for a delay-seconds value long enough to overflow Number()', () => {
    // The regex has no digit-count limit; a malformed/hostile response could send hundreds of
    // digits. Returning Infinity here would reach setTimeout() downstream, which doesn't hang on
    // Infinity but does emit a TimeoutOverflowWarning in Node — this must be treated the same as
    // an unparseable header instead.
    expect(parseRetryAfter(headersWith('9'.repeat(400)))).toBeUndefined();
  });

  it('parses an IMF-fixdate (the format Date#toUTCString produces)', () => {
    const future = new Date(Date.now() + 60_000);
    const delay = parseRetryAfter(headersWith(future.toUTCString()));
    expect(delay).toBeGreaterThan(55_000);
    expect(delay).toBeLessThan(65_000);
  });

  it('parses an RFC 850 date', () => {
    const future = new Date(Date.now() + 60_000);
    const weekday = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][future.getUTCDay()];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const dd = String(future.getUTCDate()).padStart(2, '0');
    const mon = months[future.getUTCMonth()];
    const yy = String(future.getUTCFullYear()).slice(-2);
    const hh = String(future.getUTCHours()).padStart(2, '0');
    const mi = String(future.getUTCMinutes()).padStart(2, '0');
    const ss = String(future.getUTCSeconds()).padStart(2, '0');
    const rfc850 = `${weekday}, ${dd}-${mon}-${yy} ${hh}:${mi}:${ss} GMT`;

    const delay = parseRetryAfter(headersWith(rfc850));
    expect(delay).toBeGreaterThan(55_000);
    expect(delay).toBeLessThan(65_000);
  });

  it('parses an asctime date', () => {
    const future = new Date(Date.now() + 60_000);
    const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const day = future.getUTCDate();
    const dayStr = day < 10 ? ` ${day}` : String(day);
    const hh = String(future.getUTCHours()).padStart(2, '0');
    const mi = String(future.getUTCMinutes()).padStart(2, '0');
    const ss = String(future.getUTCSeconds()).padStart(2, '0');
    const asctime = `${weekdays[future.getUTCDay()]} ${months[future.getUTCMonth()]} ${dayStr} ${hh}:${mi}:${ss} ${future.getUTCFullYear()}`;

    const delay = parseRetryAfter(headersWith(asctime));
    expect(delay).toBeGreaterThan(55_000);
    expect(delay).toBeLessThan(65_000);
  });

  it('returns undefined for a value that is neither delay-seconds nor a recognized date format', () => {
    expect(parseRetryAfter(headersWith('not-a-date'))).toBeUndefined();
  });

  it('returns undefined for an IMF-fixdate with an out-of-range time component', () => {
    // Matches the regex shape but hours=99 is semantically invalid.
    expect(parseRetryAfter(headersWith('Thu, 01 Jan 2026 99:00:00 GMT'))).toBeUndefined();
  });

  it('returns undefined for an IMF-fixdate with a calendar-impossible date (Feb 30)', () => {
    // Date.UTC() would silently roll this over to March — the round-trip check must catch it.
    expect(parseRetryAfter(headersWith('Mon, 30 Feb 2026 12:00:00 GMT'))).toBeUndefined();
  });

  it('applies the leap-second adjustment for an IMF-fixdate with :60 seconds', () => {
    // RFC 9110 §5.6.7 allows a leap second; Date has no leap-second concept, so createTimestamp
    // clamps to :59 for the round-trip validity check and then adds the second back afterwards —
    // ":60" in minute M must resolve to the exact same instant as ":00" in minute M+1.
    //
    // parseRetryAfter() computes its returned delay from `timestamp - Date.now()`, called fresh
    // on every invocation — comparing two such delays with real wall-clock time is inherently
    // racy (whatever real time elapses between the two calls shows up as a difference), so the
    // clock is frozen here to make both calls see an identical Date.now().
    vi.useFakeTimers();
    try {
      const base = new Date(Date.now() + 60_000);
      base.setUTCSeconds(0, 0);
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const dd = String(base.getUTCDate()).padStart(2, '0');
      const mon = months[base.getUTCMonth()];
      const hh = String(base.getUTCHours()).padStart(2, '0');
      const mi = String(base.getUTCMinutes()).padStart(2, '0');
      const leapDate = `Mon, ${dd} ${mon} ${base.getUTCFullYear()} ${hh}:${mi}:60 GMT`;
      const nextMinuteDate = new Date(base.getTime() + 60_000).toUTCString();

      expect(parseRetryAfter(headersWith(leapDate))).toBe(parseRetryAfter(headersWith(nextMinuteDate)));
    } finally {
      vi.useRealTimers();
    }
  });
});
