// Retry-After header parsing — RFC 9110 §10.2.3. Comes as either an integer delay-seconds value
// or one of three legacy HTTP-date formats (IMF-fixdate / RFC 850 / asctime). Ported from ky's
// `retry-timing.ts` algorithm.

const DELAY_SECONDS_RE = /^\d+$/;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const IMF_FIXDATE_RE =
  /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), (\d{2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4}) (\d{2}):(\d{2}):(\d{2}) GMT$/;
const RFC850_RE =
  /^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), (\d{2})-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-(\d{2}) (\d{2}):(\d{2}):(\d{2}) GMT$/;
const ASCTIME_RE =
  /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{2}| \d) (\d{2}:\d{2}:\d{2}) (\d{4})$/;

interface DateParts {
  year: number;
  month: string;
  day: string;
  hours: string;
  minutes: string;
  seconds: string;
}

function createTimestamp({ year, month, day, hours, minutes, seconds }: DateParts): number | undefined {
  const monthIndex = MONTHS.indexOf(month);
  const dayNumber = Number(day);
  const hoursNumber = Number(hours);
  const minutesNumber = Number(minutes);
  const secondsNumber = Number(seconds);
  if (monthIndex === -1 || hoursNumber > 23 || minutesNumber > 59 || secondsNumber > 60) {
    return undefined;
  }

  const normalizedSeconds = Math.min(secondsNumber, 59);
  const date = new Date(Date.UTC(year, monthIndex, dayNumber, hoursNumber, minutesNumber, normalizedSeconds));
  date.setUTCFullYear(year); // guards against Date.UTC() treating a 2-digit year as 19xx

  // Date.UTC silently rolls over out-of-range values, so read each field back to confirm it was actually valid.
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== monthIndex ||
    date.getUTCDate() !== dayNumber ||
    date.getUTCHours() !== hoursNumber ||
    date.getUTCMinutes() !== minutesNumber ||
    date.getUTCSeconds() !== normalizedSeconds
  ) {
    return undefined;
  }

  return secondsNumber === 60 ? date.getTime() + 1000 : date.getTime(); // leap-second adjustment
}

function parseHttpDate(value: string): number | undefined {
  const imf = IMF_FIXDATE_RE.exec(value);
  if (imf) {
    return createTimestamp({ day: imf[1], month: imf[2], year: Number(imf[3]), hours: imf[4], minutes: imf[5], seconds: imf[6] });
  }

  const rfc850 = RFC850_RE.exec(value);
  if (rfc850) {
    const now = new Date();
    const twoDigitYear = Number(rfc850[3]);
    const currentCentury = Math.floor(now.getUTCFullYear() / 100) * 100;
    const fiftyYearsFromNow = Date.UTC(
      now.getUTCFullYear() + 50,
      now.getUTCMonth(),
      now.getUTCDate(),
      now.getUTCHours(),
      now.getUTCMinutes(),
      now.getUTCSeconds(),
    );

    // RFC 9110: a 2-digit year resolves to the latest century that doesn't exceed 50 years from now.
    let timestamp: number | undefined;
    for (const year of [currentCentury - 100 + twoDigitYear, currentCentury + twoDigitYear, currentCentury + 100 + twoDigitYear]) {
      const candidate = createTimestamp({ day: rfc850[1], month: rfc850[2], year, hours: rfc850[4], minutes: rfc850[5], seconds: rfc850[6] });
      if (candidate !== undefined && candidate <= fiftyYearsFromNow) {
        timestamp = candidate;
      }
    }
    return timestamp;
  }

  const asctime = ASCTIME_RE.exec(value);
  if (asctime) {
    const [hours, minutes, seconds] = asctime[3].split(':') as [string, string, string];
    return createTimestamp({ day: asctime[2].trim(), month: asctime[1], year: Number(asctime[4]), hours, minutes, seconds });
  }

  return undefined;
}

/** Parses the `Retry-After` header into a delay in ms. `undefined` if absent or unparseable. */
export function parseRetryAfter(headers: Headers): number | undefined {
  const value = headers.get('retry-after');
  if (value === null) return undefined;

  if (DELAY_SECONDS_RE.test(value)) {
    // The regex has no digit-count limit, so an absurdly long value (a malformed or hostile
    // response) can overflow Number() to Infinity — without this guard that would propagate all
    // the way to setTimeout(), which doesn't hang on Infinity but does log a noisy
    // TimeoutOverflowWarning in Node. Treat it the same as an unparseable header instead.
    const seconds = Number(value);
    return Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : undefined;
  }

  const timestamp = parseHttpDate(value);
  if (timestamp === undefined) return undefined;

  const delay = timestamp - Date.now();
  // timestamp only ever reaches here as a real Date#getTime() result (parseHttpDate/createTimestamp
  // already reject anything that fails the round-trip validity check), and Date.now() is always
  // finite — so `delay` cannot actually be non-finite. Kept as a guard for defense in depth, not
  // because there's a reachable input that hits it.
  /* v8 ignore next */
  return Number.isFinite(delay) ? Math.max(0, delay) : undefined;
}
