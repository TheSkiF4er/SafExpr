// SafExpr/tests/integration/syntax-cases.spec.ts
//
// Integration tests for Safexpr syntax coverage.
//
// These tests focus on:
//  - End-to-end parsing + evaluation for all supported syntax primitives.
//  - Operator precedence and associativity.
//  - Property access, arrays, logical & ternary expressions.
//  - Function calls via the engine.
//  - Basic negative cases for invalid syntax.
//

import { describe, it, expect } from 'vitest';
import { compile, createEngine, SafexprError } from '../../src';

// -----------------------------------------------------------------------------
// Shared types & context
// -----------------------------------------------------------------------------

type User = {
  id: string;
  name: string;
  age: number;
  country: string;
  premium: boolean;
};

type BasicContext = {
  n: number;
  m: number;
  bool: boolean;
  text: string;
  user: User;
  items: number[];
};

const ctx: BasicContext = {
  n: 10,
  m: 3,
  bool: true,
  text: 'hello',
  user: {
    id: 'u1',
    name: 'Alice',
    age: 21,
    country: 'US',
    premium: true,
  },
  items: [1, 2, 3, 4],
};

// -----------------------------------------------------------------------------
// Helper
// -----------------------------------------------------------------------------

function evalExpr<R = unknown>(expression: string, context: BasicContext = ctx): R {
  const fn = compile<BasicContext, R>(expression);
  return fn.eval(context);
}

// -----------------------------------------------------------------------------
// Tests: literals & simple identifiers
// -----------------------------------------------------------------------------

describe('Syntax – literals and identifiers', () => {
  it('evaluates numeric literals', () => {
    expect(evalExpr<number>('0')).toBe(0);
    expect(evalExpr<number>('42')).toBe(42);
    expect(evalExpr<number>('3.14')).toBeCloseTo(3.14);
    expect(evalExpr<number>('.5')).toBeCloseTo(0.5);
  });

  it('evaluates string literals (single and double quotes)', () => {
    expect(evalExpr<string>(`"hello"`)).toBe('hello');
    expect(evalExpr<string>(`'world'`)).toBe('world');
  });

  it('evaluates boolean-like identifiers from context', () => {
    expect(evalExpr<boolean>('bool')).toBe(true);
  });

  it('reads simple identifiers from context', () => {
    expect(evalExpr<number>('n')).toBe(10);
    expect(evalExpr<number>('m')).toBe(3);
    expect(evalExpr<string>('text')).toBe('hello');
  });
});

// -----------------------------------------------------------------------------
// Tests: arithmetic operators & precedence
// -----------------------------------------------------------------------------

describe('Syntax – arithmetic & precedence', () => {
  it('supports basic arithmetic operations', () => {
    expect(evalExpr<number>('n + m')).toBe(13);
    expect(evalExpr<number>('n - m')).toBe(7);
    expect(evalExpr<number>('n * m')).toBe(30);
    expect(evalExpr<number>('n / m')).toBeCloseTo(10 / 3);
    expect(evalExpr<number>('n % m')).toBe(10 % 3);
  });

  it('respects operator precedence (multiplication before addition)', () => {
    expect(evalExpr<number>('1 + 2 * 3')).toBe(1 + 2 * 3);
    expect(evalExpr<number>('1 + 2 * 3 + 4')).toBe(1 + 2 * 3 + 4);
    expect(evalExpr<number>('(1 + 2) * 3')).toBe((1 + 2) * 3);
  });

  it('handles nested parentheses', () => {
    expect(evalExpr<number>('((n + m) * (n - m))')).toBe((10 + 3) * (10 - 3));
  });

  it('evaluates unary minus where supported', () => {
    expect(evalExpr<number>('-n')).toBe(-10);
    expect(evalExpr<number>('-(n - m)')).toBe(-(10 - 3));
  });
});

// -----------------------------------------------------------------------------
// Tests: comparison & logical operators
// -----------------------------------------------------------------------------

describe('Syntax – comparisons & logical operators', () => {
  it('evaluates comparison operators', () => {
    expect(evalExpr<boolean>('n == 10')).toBe(true);
    expect(evalExpr<boolean>('n != 10')).toBe(false);
    expect(evalExpr<boolean>('n > m')).toBe(true);
    expect(evalExpr<boolean>('n >= 10')).toBe(true);
    expect(evalExpr<boolean>('n < m')).toBe(false);
    expect(evalExpr<boolean>('n <= 10')).toBe(true);
  });

  it('evaluates logical operators', () => {
    expect(evalExpr<boolean>('true && true')).toBe(true);
    expect(evalExpr<boolean>('true && false')).toBe(false);
    expect(evalExpr<boolean>('true || false')).toBe(true);
    expect(evalExpr<boolean>('false || false')).toBe(false);
    expect(evalExpr<boolean>('!true')).toBe(false);
    expect(evalExpr<boolean>('!false')).toBe(true);
  });

  it('combines logical and comparison operators', () => {
    expect(evalExpr<boolean>('n > m && user.age >= 18')).toBe(true);
    expect(evalExpr<boolean>('n < m || user.country == "US"')).toBe(true);
    expect(
      evalExpr<boolean>(
        '(n > m && user.premium) || (user.age < 18 && user.country == "US")',
      ),
    ).toBe(true);
  });

  it('respects logical operator precedence (&& before ||)', () => {
    expect(evalExpr<boolean>('false || true && false')).toBe(false);
    expect(evalExpr<boolean>('(false || true) && false')).toBe(false);
    expect(evalExpr<boolean>('true || false && false')).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// Tests: ternary operator
// -----------------------------------------------------------------------------

describe('Syntax – ternary operator', () => {
  it('evaluates simple ternaries', () => {
    expect(evalExpr<string>('n > m ? "larger" : "smaller"')).toBe('larger');
    expect(evalExpr<string>('n < m ? "yes" : "no"')).toBe('no');
  });

  it('supports nested ternaries', () => {
    const expr =
      'user.age < 18 ? "child" : user.age < 30 ? "young-adult" : "adult"';
    expect(evalExpr<string>(expr)).toBe('young-adult');
  });

  it('supports ternaries mixed with arithmetic', () => {
    const expr = 'user.premium ? n * 2 : n * 0.5';
    expect(evalExpr<number>(expr)).toBe(20);
  });
});

// -----------------------------------------------------------------------------
// Tests: property access & arrays
// -----------------------------------------------------------------------------

describe('Syntax – property access & arrays', () => {
  it('reads nested object properties', () => {
    expect(evalExpr<number>('user.age')).toBe(21);
    expect(evalExpr<string>('user.country')).toBe('US');
    expect(evalExpr<boolean>('user.premium')).toBe(true);
  });

  it('supports array indexing', () => {
    expect(evalExpr<number>('items[0]')).toBe(1);
    expect(evalExpr<number>('items[1]')).toBe(2);
    expect(evalExpr<number>('items[3]')).toBe(4);
  });

  it('uses nested property and array access together', () => {
    const localCtx: BasicContext = {
      ...ctx,
      items: [ctx.user.age, ctx.n, ctx.m],
    };
    expect(evalExpr<number>('items[0]', localCtx)).toBe(localCtx.user.age);
  });

  it('combines property access, arrays, and arithmetic', () => {
    const expr = 'items[0] + items[1] * 2 + user.age';
    const expected = ctx.items[0] + ctx.items[1] * 2 + ctx.user.age;
    expect(evalExpr<number>(expr)).toBe(expected);
  });
});

// -----------------------------------------------------------------------------
// Tests: function calls via engine
// -----------------------------------------------------------------------------

describe('Syntax – function calls (engine)', () => {
  const engine = createEngine()
    .withFunction('max', (a: number, b: number) => Math.max(a, b))
    .withFunction('min', (a: number, b: number) => Math.min(a, b))
    .withFunction('len', (arr: unknown[]) => arr.length)
    .withFunction(
      'segment',
      (age: number): string =>
        age < 18 ? 'child' : age < 30 ? 'young-adult' : 'adult',
    )
    .withFunction('ifNull', <T,>(value: T | null | undefined, fallback: T): T =>
      value == null ? fallback : value,
    );

  it('calls simple numeric functions', () => {
    const expr = 'max(n, m) + min(n, m)';
    const compiled = engine.compile<BasicContext, number>(expr);
    const val = compiled.eval(ctx);
    expect(val).toBe(Math.max(ctx.n, ctx.m) + Math.min(ctx.n, ctx.m));
  });

  it('calls functions with array arguments', () => {
    const expr = 'len(items) * 2';
    const compiled = engine.compile<BasicContext, number>(expr);
    const val = compiled.eval(ctx);
    expect(val).toBe(ctx.items.length * 2);
  });

  it('calls functions in ternary conditions', () => {
    const expr = 'segment(user.age) == "young-adult" ? "ok" : "error"';
    const compiled = engine.compile<BasicContext, string>(expr);
    const val = compiled.eval(ctx);
    expect(val).toBe('ok');
  });

  it('uses helper functions as part of arithmetic expressions', () => {
    const expr = 'ifNull(n, 0) + ifNull(m, 1)';
    const compiled = engine.compile<BasicContext, number>(expr);
    const val = compiled.eval(ctx);
    expect(val).toBe(ctx.n + ctx.m);
  });
});

// -----------------------------------------------------------------------------
// Tests: combinations of syntax features
// -----------------------------------------------------------------------------

describe('Syntax – combined cases', () => {
  it('handles a complex combined expression', () => {
    const expr = `
      (user.premium && user.country == "US" && n > m
        ? (n * m + items[2]) / (1 + user.age - 20)
        : 0
      )
    `;
    const compiled = compile<BasicContext, number>(expr);
    const val = compiled.eval(ctx);

    const expected =
      ctx.user.premium && ctx.user.country === 'US' && ctx.n > ctx.m
        ? (ctx.n * ctx.m + ctx.items[2]) / (1 + ctx.user.age - 20)
        : 0;

    expect(val).toBeCloseTo(expected);
  });

  it('compares string properties and uses them in ternaries', () => {
    const expr = `
      user.country == "US"
        ? (user.premium ? "US-premium" : "US-standard")
        : "non-US"
    `;
    const label = evalExpr<string>(expr);
    expect(label).toBe('US-premium');

    const label2 = evalExpr<string>(expr, {
      ...ctx,
      user: { ...ctx.user, premium: false },
    });
    expect(label2).toBe('US-standard');

    const label3 = evalExpr<string>(expr, {
      ...ctx,
      user: { ...ctx.user, country: 'DE' },
    });
    expect(label3).toBe('non-US');
  });
});

// -----------------------------------------------------------------------------
// Tests: negative syntax cases
// -----------------------------------------------------------------------------

describe('Syntax – negative / invalid cases', () => {
  it('throws SafexprError on obvious syntax errors', () => {
    const invalidExpressions = [
      'n * * m',
      '(n + m',
      'user.age >',
      '"unterminated string',
    ];

    for (const expr of invalidExpressions) {
      let caught: unknown;
      try {
        const fn = compile<BasicContext, unknown>(expr);
        fn.eval(ctx);
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeDefined();
      expect(caught).toBeInstanceOf(SafexprError);
      const se = caught as SafexprError;
      expect(typeof se.message).toBe('string');
      expect(typeof se.column).toBe('number');
      expect(typeof se.snippet).toBe('string');
    }
  });

  it('fails gracefully when using unsupported or malformed tokens', () => {
    const expr = 'n *** m'; // unsupported operator
    let caught: unknown;

    try {
      const fn = compile<BasicContext, unknown>(expr);
      fn.eval(ctx);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(SafexprError);
  });
});
