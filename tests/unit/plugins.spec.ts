// SafExpr/tests/unit/plugins.spec.ts
//
// Unit tests for *userland plugins* built on top of Safexpr’s engine.
//
// Safexpr itself only guarantees a low-level primitive:
//
//   const engine = createEngine()
//     .withFunction('name', fn);
//
// These tests show/verify a recommended pattern for building higher-level
// “plugins” on top of that primitive – small, composable helpers that
// register groups of related functions in a single call.
//
// Focus areas:
//  - Plugin composition (math + collections + dates).
//  - Reusability: same plugin applied to different engine instances.
//  - Isolation: engines without a plugin don’t magically see its functions.
//  - Safe defaults: plugins behave predictably with edge-case inputs.
//

import { describe, it, expect } from 'vitest';
import { createEngine, SafexprError } from '../../src';

// -----------------------------------------------------------------------------
// Types & helpers
// -----------------------------------------------------------------------------

type Engine = ReturnType<typeof createEngine>;

type Context = {
  n: number;
  m: number;
  nums: number[];
  user: {
    id: string;
    age: number;
    country: string;
  };
  dates: {
    from: string; // ISO-ish strings
    to: string;
  };
};

const baseCtx: Context = {
  n: 10,
  m: 3,
  nums: [1, 2, 3, 4, 5],
  user: {
    id: 'u1',
    age: 21,
    country: 'US',
  },
  dates: {
    from: '2024-01-10',
    to: '2024-01-15',
  },
};

// -----------------------------------------------------------------------------
// Example plugin implementations (userland)
// -----------------------------------------------------------------------------

/**
 * A tiny math plugin that registers basic numeric helpers.
 *
 * Example usage:
 *   const engine = mathPlugin(createEngine());
 *   const compiled = engine.compile<Ctx, number>('clamp(n * 2, 0, 10)');
 */
function mathPlugin(engine: Engine): Engine {
  return engine
    .withFunction('abs', (x: number): number => (x < 0 ? -x : x))
    .withFunction('round', (x: number): number => Math.round(x))
    .withFunction('clamp', (x: number, min: number, max: number): number =>
      x < min ? min : x > max ? max : x,
    );
}

/**
 * Collection plugin: helpers that work on arrays of numbers.
 */
function collectionPlugin(engine: Engine): Engine {
  return engine
    .withFunction('sum', (items: number[]): number =>
      items.reduce((acc, n) => acc + n, 0),
    )
    .withFunction('avg', (items: number[]): number =>
      items.length === 0
        ? 0
        : items.reduce((acc, n) => acc + n, 0) / items.length,
    )
    .withFunction(
      'max',
      (items: number[]): number | null =>
        items.length === 0 ? null : items.reduce((acc, n) => (n > acc ? n : acc)),
    );
}

/**
 * Configurable math plugin factory, to show how plugins can be parameterized.
 */
type MathPluginOptions = {
  roundResult?: boolean;
};

function createConfiguredMathPlugin(options: MathPluginOptions) {
  return function configuredMathPlugin(engine: Engine): Engine {
    const roundResult = options.roundResult === true;

    return engine.withFunction('safeDiv', (a: number, b: number): number => {
      if (b === 0) return 0;
      const result = a / b;
      return roundResult ? Math.round(result) : result;
    });
  };
}

/**
 * Minimal date plugin. It intentionally keeps logic simple:
 * - parseDate: converts "YYYY-MM-DD" to a numeric timestamp
 * - daysBetween: absolute day difference between two ISO dates
 */
function datePlugin(engine: Engine): Engine {
  const parseDate = (iso: string): number => {
    // Implementation detail: Date parsing here is for example purposes only.
    // In a real library you might want a stricter parser / validation.
    const time = Date.parse(iso);
    if (Number.isNaN(time)) {
      throw new Error(`Invalid date: ${iso}`);
    }
    return time;
  };

  return engine
    .withFunction('parseDate', (iso: string): number => parseDate(iso))
    .withFunction('daysBetween', (from: string, to: string): number => {
      const a = parseDate(from);
      const b = parseDate(to);
      const diffMs = Math.abs(b - a);
      return Math.floor(diffMs / (1000 * 60 * 60 * 24));
    });
}

// -----------------------------------------------------------------------------
// Tests: mathPlugin
// -----------------------------------------------------------------------------

describe('Plugins – mathPlugin', () => {
  it('registers abs, round, and clamp helpers', () => {
    const engine = mathPlugin(createEngine());

    const expr = 'clamp(abs(-n * 2), 0, 25) + round(1.2)';
    const compiled = engine.compile<Context, number>(expr);
    const result = compiled.eval(baseCtx);

    const expected = Math.max(0, Math.min(25, Math.abs(-baseCtx.n * 2))) + Math.round(1.2);
    expect(result).toBe(expected);
  });

  it('can be applied to multiple independent engine instances', () => {
    const engine1 = mathPlugin(createEngine());
    const engine2 = mathPlugin(createEngine());

    const expr = 'abs(-n) + clamp(m, 0, 2)';
    const compiled1 = engine1.compile<Context, number>(expr);
    const compiled2 = engine2.compile<Context, number>(expr);

    const ctx1: Context = { ...baseCtx, n: 5, m: 10 };
    const ctx2: Context = { ...baseCtx, n: 7, m: -1 };

    expect(compiled1.eval(ctx1)).toBe(Math.abs(-5) + 2);
    expect(compiled2.eval(ctx2)).toBe(Math.abs(-7) + 0);
  });

  it('does not leak plugin functions into engines that did not use the plugin', () => {
    const withPlugin = mathPlugin(createEngine());
    const withoutPlugin = createEngine();

    const expr = 'abs(-n) + round(m)';

    // Engine with plugin => OK
    const ok = withPlugin.compile<Context, number>(expr);
    expect(ok.eval(baseCtx)).toBe(Math.abs(-10) + Math.round(3));

    // Engine without plugin => should fail when trying to evaluate
    let caught: unknown;
    try {
      const bad = withoutPlugin.compile<Context, number>(expr);
      bad.eval(baseCtx);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
  });
});

// -----------------------------------------------------------------------------
// Tests: collectionPlugin
// -----------------------------------------------------------------------------

describe('Plugins – collectionPlugin', () => {
  it('computes sum, avg, and max for numeric arrays', () => {
    const engine = collectionPlugin(createEngine());

    const expr = 'sum(nums) + avg(nums) + (max(nums) ?? 0)';
    const compiled = engine.compile<Context, number>(expr);
    const result = compiled.eval(baseCtx);

    const sum = baseCtx.nums.reduce((a, b) => a + b, 0);
    const avg = sum / baseCtx.nums.length;
    const max = baseCtx.nums.reduce((a, b) => (b > a ? b : a));
    const expected = sum + avg + max;

    expect(result).toBe(expected);
  });

  it('handles empty arrays in a safe and predictable way', () => {
    const engine = collectionPlugin(createEngine());

    const expr = 'sum(nums) + avg(nums) + (max(nums) == null ? 100 : 0)';

    const ctx: Context = {
      ...baseCtx,
      nums: [],
    };

    const compiled = engine.compile<Context, number>(expr);
    const result = compiled.eval(ctx);

    // For an empty array, plugin behavior:
    //   sum([]) => 0
    //   avg([]) => 0
    //   max([]) => null
    // So the expression becomes 0 + 0 + 100 = 100
    expect(result).toBe(100);
  });

  it('is composable with mathPlugin on the same engine instance', () => {
    const engine = collectionPlugin(mathPlugin(createEngine()));

    const expr = 'clamp(sum(nums), 0, 10) + abs(-m)';
    const compiled = engine.compile<Context, number>(expr);

    const sum = baseCtx.nums.reduce((a, b) => a + b, 0);
    const expected = Math.max(0, Math.min(10, sum)) + Math.abs(-baseCtx.m);

    expect(compiled.eval(baseCtx)).toBe(expected);
  });
});

// -----------------------------------------------------------------------------
// Tests: configured math plugin (factory)
// -----------------------------------------------------------------------------

describe('Plugins – configured math plugin (factory)', () => {
  it('respects configuration (roundResult: false)', () => {
    const noRoundPlugin = createConfiguredMathPlugin({ roundResult: false });
    const engine = noRoundPlugin(createEngine());

    const expr = 'safeDiv(n, m)';
    const compiled = engine.compile<Context, number>(expr);

    const expected = baseCtx.n / baseCtx.m;
    expect(compiled.eval(baseCtx)).toBeCloseTo(expected);
  });

  it('respects configuration (roundResult: true)', () => {
    const roundPlugin = createConfiguredMathPlugin({ roundResult: true });
    const engine = roundPlugin(createEngine());

    const expr = 'safeDiv(n, m)';
    const compiled = engine.compile<Context, number>(expr);

    const expected = Math.round(baseCtx.n / baseCtx.m);
    expect(compiled.eval(baseCtx)).toBe(expected);
  });

  it('handles division by zero using a safe default (0)', () => {
    const plugin = createConfiguredMathPlugin({ roundResult: true });
    const engine = plugin(createEngine());

    const expr = 'safeDiv(n, 0)';
    const compiled = engine.compile<Context, number>(expr);

    const ctx: Context = { ...baseCtx, n: 123 };
    const result = compiled.eval(ctx);
    expect(result).toBe(0);
  });
});

// -----------------------------------------------------------------------------
// Tests: datePlugin
// -----------------------------------------------------------------------------

describe('Plugins – datePlugin', () => {
  it('computes daysBetween correctly for ISO-like date strings', () => {
    const engine = datePlugin(createEngine());

    const expr = 'daysBetween(dates.from, dates.to)';
    const compiled = engine.compile<Context, number>(expr);

    const result = compiled.eval(baseCtx);
    // 2024-01-10 -> 2024-01-15 => 5 days
    expect(result).toBe(5);
  });

  it('can be composed with math and collection plugins', () => {
    const engine = mathPlugin(collectionPlugin(datePlugin(createEngine())));

    const expr =
      'clamp(daysBetween(dates.from, dates.to) + sum(nums), 0, 100)';
    const compiled = engine.compile<Context, number>(expr);

    const sum = baseCtx.nums.reduce((a, b) => a + b, 0);
    const expected = Math.max(0, Math.min(100, 5 + sum));

    expect(compiled.eval(baseCtx)).toBe(expected);
  });

  it('surfaces errors when invalid date strings are used', () => {
    const engine = datePlugin(createEngine());

    const expr = 'daysBetween("not-a-date", "2024-01-01")';
    const compiled = engine.compile<Context, number>(expr);

    let caught: unknown;
    try {
      compiled.eval(baseCtx);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
  });
});

// -----------------------------------------------------------------------------
// Tests: DX / error behavior for plugin-registered functions
// -----------------------------------------------------------------------------

describe('Plugins – error behavior & DX', () => {
  it('does not swallow errors thrown inside plugin functions', () => {
    const engine = createEngine().withFunction('pluginBoom', () => {
      throw new Error('plugin-bang');
    });

    const expr = 'pluginBoom()';
    const compiled = engine.compile<Context, unknown>(expr);

    let caught: unknown;
    try {
      compiled.eval(baseCtx);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
  });

  it('may wrap plugin errors in SafexprError for better diagnostics (aspirational)', () => {
    const engine = createEngine().withFunction('bad', () => {
      throw new Error('fail-inside-plugin');
    });

    const expr = 'bad()';
    const compiled = engine.compile<Context, unknown>(expr);

    let caught: unknown;
    try {
      compiled.eval(baseCtx);
    } catch (err) {
      caught = err;
    }

    // Implementation choice:
    //  - Either SafexprError wrapping the original error, or
    //  - The original error.
    //
    // We at least assert it's not silently ignored.
    if (caught instanceof SafexprError) {
      expect(typeof caught.message).toBe('string');
      expect(caught.message.toLowerCase()).toContain('bad');
    } else {
      expect(caught).toBeDefined();
    }
  });

  it('fails cleanly when calling functions that a plugin was supposed to provide but did not', () => {
    // Example: a consumer *assumes* mathPlugin was applied, but it was not.
    const engine = createEngine();
    const expr = 'clamp(n, 0, 100)';

    let caught: unknown;
    try {
      const compiled = engine.compile<Context, number>(expr);
      compiled.eval(baseCtx);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
  });
});
