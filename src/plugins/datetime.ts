/**
 * SafExpr – Datetime plugin
 *
 * A small, batteries-included set of datetime helpers for SafExpr expressions.
 *
 * The plugin registers helpers for:
 *
 *   - now()                    → number (ms since epoch)
 *   - today()                  → number (ms since epoch, start of day)
 *   - date(value)              → number (normalize to ms since epoch)
 *   - timestamp(value)         → number (alias for date())
 *   - addDays(ts, days)        → number
 *   - addMinutes(ts, minutes)  → number
 *   - diffDays(a, b)           → number (a - b, in days)
 *   - diffMinutes(a, b)        → number (a - b, in minutes)
 *   - isBefore(a, b)           → boolean
 *   - isAfter(a, b)            → boolean
 *   - isBetween(t, start, end, inclusive?) → boolean
 *   - formatDate(ts, pattern?, mode?)      → string
 *   - parseDate(str)           → number
 *
 * All helpers are timezone-aware in a simple way via a `timeZoneMode` option:
 *
 *   - 'local' (default) – today() uses local midnight; formatDate("date" / "datetime" / "time")
 *   - 'utc'             – today() uses UTC midnight; formatDate("iso"/"iso-date"/"iso-datetime")
 *
 * Internally, everything is represented as a JS `number` timestamp
 * (milliseconds since Unix epoch). This keeps expressions simple and allows
 * direct comparisons:
 *
 *   isBefore(timestamp(order.createdAt), addDays(today(), -30))
 *
 * Example:
 *
 *   import { createEngine } from '../core/engine';
 *   import { datetimePlugin } from '../plugins/datetime';
 *
 *   type Ctx = { order: { createdAt: string } };
 *
 *   const engine = datetimePlugin(createEngine());
 *
 *   const expr = engine.compile<Ctx, boolean>(
 *     'isAfter(timestamp(order.createdAt), addDays(today(), -30))',
 *   );
 *
 *   expr.eval({ order: { createdAt: '2025-01-10T12:00:00Z' } });
 *
 * License: Apache-2.0
 * Author:  TheSkiF4er
 */

import type { Engine, UserFunction } from '../core/engine';

/////////////////////////////
// Plugin configuration    //
/////////////////////////////

export type TimeZoneMode = 'local' | 'utc';

export interface DatetimePluginOptions {
  /**
   * Optional prefix added to every helper name.
   *
   * Example:
   *   prefix = "dt_"
   *   → "now" becomes "dt_now", "addDays" becomes "dt_addDays", etc.
   *
   * Default: '' (no prefix).
   */
  prefix?: string;

  /**
   * Time zone mode for helpers that depend on "today" or human-friendly
   * formatting.
   *
   * - 'local' (default): use local timezone for today() and "date"/"datetime"/"time".
   * - 'utc': use UTC midnight for today(); ISO helpers are always UTC-based.
   */
  timeZoneMode?: TimeZoneMode;

  /**
   * Custom clock provider, mostly for testing.
   *
   * Default:
   *   () => new Date()
   */
  nowProvider?: () => Date;
}

/**
 * Datetime plugin entry point.
 *
 * Usage:
 *
 *   const engine = datetimePlugin(createEngine(), { prefix: 'dt_' });
 */
export function datetimePlugin(
  engine: Engine,
  options: DatetimePluginOptions = {},
): Engine {
  const {
    prefix = '',
    timeZoneMode = 'local',
    nowProvider = () => new Date(),
  } = options;

  const name = (base: string): string => (prefix ? `${prefix}${base}` : base);

  const ctx: DatetimeContext = {
    nowProvider,
    timeZoneMode,
  };

  let result = engine;

  // Core time helpers
  result = result
    .withFunction(name('now'), makeNowFn(ctx))
    .withFunction(name('today'), makeTodayFn(ctx))
    .withFunction(name('date'), makeDateFn(ctx))
    .withFunction(name('timestamp'), makeDateFn(ctx)); // alias

  // Arithmetic / differences
  result = result
    .withFunction(name('addDays'), makeAddDaysFn(ctx))
    .withFunction(name('addMinutes'), makeAddMinutesFn(ctx))
    .withFunction(name('diffDays'), makeDiffDaysFn(ctx))
    .withFunction(name('diffMinutes'), makeDiffMinutesFn(ctx));

  // Comparisons
  result = result
    .withFunction(name('isBefore'), makeIsBeforeFn(ctx))
    .withFunction(name('isAfter'), makeIsAfterFn(ctx))
    .withFunction(name('isBetween'), makeIsBetweenFn(ctx));

  // Parsing / formatting
  result = result
    .withFunction(name('parseDate'), makeParseDateFn(ctx))
    .withFunction(name('formatDate'), makeFormatDateFn(ctx));

  return result;
}

/**
 * Default export for convenience:
 *
 *   import datetimePlugin from 'safexpr/plugins/datetime';
 */
export default datetimePlugin;

/////////////////////////////
// Internal context & utils //
/////////////////////////////

interface DatetimeContext {
  nowProvider: () => Date;
  timeZoneMode: TimeZoneMode;
}

/**
 * Normalize arbitrary input into a timestamp (ms since epoch).
 *
 * Accepts:
 *  - number → treated as timestamp
 *  - string → parsed via Date.parse()
 *  - Date   → date.getTime()
 *
 * Throws on invalid dates.
 */
function toTimestamp(value: unknown, fnName: string): number {
  if (value instanceof Date) {
    const ms = value.getTime();
    if (!Number.isFinite(ms)) {
      throw new Error(
        `SafExpr datetime: ${fnName}() received an invalid Date instance.`,
      );
    }
    return ms;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(
        `SafExpr datetime: ${fnName}() received a non-finite number.`,
      );
    }
    return value;
  }

  if (typeof value === 'string') {
    const ms = Date.parse(value);
    if (!Number.isFinite(ms)) {
      throw new Error(
        `SafExpr datetime: ${fnName}() could not parse date string "${value}".`,
      );
    }
    return ms;
  }

  throw new Error(
    `SafExpr datetime: ${fnName}() expected a Date, number, or string, got ${typeof value}.`,
  );
}

/**
 * Start-of-day (midnight) timestamp for a given date, according to the
 * configured timezone mode.
 */
function startOfDay(date: Date, mode: TimeZoneMode): number {
  if (mode === 'utc') {
    const t = Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      0,
      0,
      0,
      0,
    );
    return t;
  }

  // local
  const d = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    0,
    0,
    0,
    0,
  );
  return d.getTime();
}

/**
 * Difference between two timestamps in minutes.
 * Returns: (a - b) / (60 * 1000)
 */
function diffMinutesInternal(a: number, b: number): number {
  return (a - b) / (60 * 1000);
}

/**
 * Difference between two timestamps in days.
 * Returns: (a - b) / (24 * 60 * 60 * 1000)
 */
function diffDaysInternal(a: number, b: number): number {
  return (a - b) / (24 * 60 * 60 * 1000);
}

/**
 * Simple pattern enumeration for formatDate.
 *
 * Supported patterns:
 *
 *  - "iso"           → ISO full datetime (e.g. "2025-01-10T12:34:56.789Z")
 *  - "iso-date"      → ISO date only (e.g. "2025-01-10")
 *  - "iso-datetime"  → ISO without milliseconds (e.g. "2025-01-10T12:34:56Z")
 *  - "date"          → locale date (e.g. "1/10/2025") – local or utc-based
 *  - "datetime"      → locale date + time
 *  - "time"          → locale time
 *
 *  (default pattern is "iso")
 */
type FormatPattern =
  | 'iso'
  | 'iso-date'
  | 'iso-datetime'
  | 'date'
  | 'datetime'
  | 'time';

/**
 * Coerce unknown pattern to valid FormatPattern or throw.
 */
function normalizePattern(pattern: unknown, fnName: string): FormatPattern {
  if (pattern == null || pattern === '') return 'iso';

  if (typeof pattern !== 'string') {
    throw new Error(
      `SafExpr datetime: ${fnName}() pattern must be a string, got ${typeof pattern}.`,
    );
  }

  const p = pattern as FormatPattern;
  switch (p) {
    case 'iso':
    case 'iso-date':
    case 'iso-datetime':
    case 'date':
    case 'datetime':
    case 'time':
      return p;
    default:
      throw new Error(
        `SafExpr datetime: ${fnName}() unsupported pattern "${pattern}".`,
      );
  }
}

/**
 * Format a timestamp using the given pattern and timezone mode.
 */
function formatTimestamp(
  timestamp: number,
  pattern: FormatPattern,
  mode: TimeZoneMode,
): string {
  const date = new Date(timestamp);

  switch (pattern) {
    case 'iso':
      return date.toISOString();
    case 'iso-date': {
      const iso = date.toISOString();
      return iso.slice(0, 10); // YYYY-MM-DD
    }
    case 'iso-datetime': {
      const iso = date.toISOString();
      // "YYYY-MM-DDTHH:mm:ss.sssZ" → "YYYY-MM-DDTHH:mm:ssZ"
      const withoutMs = iso.replace(/\.\d{3}Z$/, 'Z');
      return withoutMs;
    }
    case 'date':
    case 'datetime':
    case 'time': {
      // Use local time formatting; if mode is 'utc', we emulate UTC by
      // normalizing the time fields first, then using toLocaleString
      // with timeZone 'UTC' when available.
      const locales = undefined; // use environment default

      if (pattern === 'date') {
        if (mode === 'utc') {
          try {
            return date.toLocaleDateString(locales, { timeZone: 'UTC' });
          } catch {
            // Fallback if timeZone not supported
            return date.toUTCString().split(' GMT')[0];
          }
        }
        return date.toLocaleDateString(locales);
      }

      if (pattern === 'time') {
        if (mode === 'utc') {
          try {
            return date.toLocaleTimeString(locales, { timeZone: 'UTC' });
          } catch {
            return date.toISOString().split('T')[1].replace('Z', '');
          }
        }
        return date.toLocaleTimeString(locales);
      }

      // pattern === 'datetime'
      if (mode === 'utc') {
        try {
          return date.toLocaleString(locales, { timeZone: 'UTC' });
        } catch {
          return date.toUTCString();
        }
      }
      return date.toLocaleString(locales);
    }
  }
}

/////////////////////////////
// Helper implementations  //
/////////////////////////////

// now(): number
function makeNowFn(ctx: DatetimeContext): UserFunction {
  return function now(): number {
    const d = ctx.nowProvider();
    const ms = d.getTime();
    if (!Number.isFinite(ms)) {
      throw new Error(
        'SafExpr datetime: now() returned an invalid Date from nowProvider().',
      );
    }
    return ms;
  };
}

// today(): number (start-of-day)
function makeTodayFn(ctx: DatetimeContext): UserFunction {
  return function today(): number {
    const d = ctx.nowProvider();
    const ms = startOfDay(d, ctx.timeZoneMode);
    if (!Number.isFinite(ms)) {
      throw new Error(
        'SafExpr datetime: today() computed an invalid timestamp.',
      );
    }
    return ms;
  };
}

// date(value): number (normalize value to timestamp)
function makeDateFn(ctx: DatetimeContext): UserFunction {
  return function date(value: unknown): number {
    return toTimestamp(value, 'date');
  };
}

// addDays(ts, days): number
function makeAddDaysFn(ctx: DatetimeContext): UserFunction {
  return function addDays(timestampLike: unknown, days: unknown): number {
    const base = toTimestamp(timestampLike, 'addDays');
    const amount =
      typeof days === 'number'
        ? days
        : typeof days === 'string'
          ? Number(days)
          : NaN;

    if (!Number.isFinite(amount)) {
      throw new Error(
        'SafExpr datetime: addDays() second argument must be a number or numeric string.',
      );
    }

    const result = base + amount * 24 * 60 * 60 * 1000;
    if (!Number.isFinite(result)) {
      throw new Error(
        'SafExpr datetime: addDays() produced an invalid timestamp.',
      );
    }

    return result;
  };
}

// addMinutes(ts, minutes): number
function makeAddMinutesFn(ctx: DatetimeContext): UserFunction {
  return function addMinutes(
    timestampLike: unknown,
    minutes: unknown,
  ): number {
    const base = toTimestamp(timestampLike, 'addMinutes');
    const amount =
      typeof minutes === 'number'
        ? minutes
        : typeof minutes === 'string'
          ? Number(minutes)
          : NaN;

    if (!Number.isFinite(amount)) {
      throw new Error(
        'SafExpr datetime: addMinutes() second argument must be a number or numeric string.',
      );
    }

    const result = base + amount * 60 * 1000;
    if (!Number.isFinite(result)) {
      throw new Error(
        'SafExpr datetime: addMinutes() produced an invalid timestamp.',
      );
    }

    return result;
  };
}

// diffDays(a, b): number
function makeDiffDaysFn(ctx: DatetimeContext): UserFunction {
  return function diffDays(a: unknown, b: unknown): number {
    const ta = toTimestamp(a, 'diffDays');
    const tb = toTimestamp(b, 'diffDays');
    return diffDaysInternal(ta, tb);
  };
}

// diffMinutes(a, b): number
function makeDiffMinutesFn(ctx: DatetimeContext): UserFunction {
  return function diffMinutes(a: unknown, b: unknown): number {
    const ta = toTimestamp(a, 'diffMinutes');
    const tb = toTimestamp(b, 'diffMinutes');
    return diffMinutesInternal(ta, tb);
  };
}

// isBefore(a, b): boolean
function makeIsBeforeFn(ctx: DatetimeContext): UserFunction {
  return function isBefore(a: unknown, b: unknown): boolean {
    const ta = toTimestamp(a, 'isBefore');
    const tb = toTimestamp(b, 'isBefore');
    return ta < tb;
  };
}

// isAfter(a, b): boolean
function makeIsAfterFn(ctx: DatetimeContext): UserFunction {
  return function isAfter(a: unknown, b: unknown): boolean {
    const ta = toTimestamp(a, 'isAfter');
    const tb = toTimestamp(b, 'isAfter');
    return ta > tb;
  };
}

// isBetween(target, start, end, inclusive?): boolean
function makeIsBetweenFn(ctx: DatetimeContext): UserFunction {
  return function isBetween(
    target: unknown,
    start: unknown,
    end: unknown,
    inclusive?: unknown,
  ): boolean {
    const tt = toTimestamp(target, 'isBetween');
    const ts = toTimestamp(start, 'isBetween');
    const te = toTimestamp(end, 'isBetween');

    const inc =
      typeof inclusive === 'boolean'
        ? inclusive
        : typeof inclusive === 'string'
          ? inclusive.toLowerCase() !== 'false'
          : true;

    if (ts <= te) {
      return inc ? tt >= ts && tt <= te : tt > ts && tt < te;
    }

    // If start > end, we still define behavior: treat interval as [end, start]
    const min = te;
    const max = ts;
    return inc ? tt >= min && tt <= max : tt > min && tt < max;
  };
}

// parseDate(str): number
function makeParseDateFn(ctx: DatetimeContext): UserFunction {
  return function parseDate(value: unknown): number {
    if (value instanceof Date || typeof value === 'number') {
      return toTimestamp(value, 'parseDate');
    }

    if (typeof value !== 'string') {
      throw new Error(
        `SafExpr datetime: parseDate() expects a string, Date, or number, got ${typeof value}.`,
      );
    }

    const ms = Date.parse(value);
    if (!Number.isFinite(ms)) {
      throw new Error(
        `SafExpr datetime: parseDate() could not parse value "${value}".`,
      );
    }

    return ms;
  };
}

// formatDate(ts, pattern?, mode?): string
function makeFormatDateFn(ctx: DatetimeContext): UserFunction {
  return function formatDate(
    timestampLike: unknown,
    pattern?: unknown,
    overrideMode?: unknown,
  ): string {
    const ts = toTimestamp(timestampLike, 'formatDate');
    const pat = normalizePattern(pattern, 'formatDate');

    let mode = ctx.timeZoneMode;
    if (overrideMode === 'local' || overrideMode === 'utc') {
      mode = overrideMode;
    } else if (
      overrideMode != null &&
      overrideMode !== '' &&
      typeof overrideMode === 'string'
    ) {
      // For other strings, we consider this a misuse and throw.
      throw new Error(
        `SafExpr datetime: formatDate() timezone mode must be "local" or "utc", got "${overrideMode}".`,
      );
    }

    return formatTimestamp(ts, pat, mode);
  };
}
