// SafExpr/tests/unit/evaluator.spec.ts
//
// Unit tests focused on the *evaluator* behavior of Safexpr.
//
// While `syntax-cases.spec.ts` covers parsing + syntax end-to-end,
// this file pays special attention to how expressions are actually
// evaluated:
//
//  - Correct arithmetic, comparison, logical, and ternary semantics.
//  - Short-circuit behavior for && / || (safety + performance).
//  - Member access and array indexing behavior.
//  - Function calls and error propagation.
//  - Handling of “weird” or edge-case inputs where reasonable.
//
// Some of these tests are slightly aspirational and may need to be
// tuned to your implementation details, but they are written to be
// realistic and library-friendly.

import { describe, it, expect } from 'vitest';
import { compile, createEngine, SafexprError } from '../../src';

// -----------------------------------------------------------------------------
// Shared types & helpers
// -----------------------------------------------------------------------------

type EvalCtx = {
  n: number;
  m: number;
  flag: boolean;
  str: string;
  user: {
    id: string;
    name: string;
    age: number;
    country?: string;
    premium?: boolean;
  };
  items: number[];
  nested?: {
    value: number;
  };
};

const baseCtx: EvalCtx = {
  n: 10,
  m: 3,
  flag: true,
  str: 'hello',
  user: {
    id: 'u1',
    name: 'Alice',
    age: 21,
    country: 'US',
    premium: true,
  },
  items: [1, 2, 3],
  nested: {
    value: 5,
  },
};

function evalExpr<R = unknown>(expression: string, ctx: EvalCtx = baseCtx): R {
  const fn = compile<EvalCtx, R>(expression);
  return fn.eval(ctx);
}

// -----------------------------------------------------------------------------
// Primitives, arithmetic & comparison semantics
// -----------------------------------------------------------------------------

describe('Evaluator – primitives & arithmetic', () => {
  it('evaluates numeric expressions correctly', () => {
    expect(evalExpr<number>('n + m')).toBe(13);
    expect(evalExpr<number>('n - m')).toBe(7);
    expect(evalExpr<number>('n * m')).toBe(30);
    expect(evalExpr<number>('n / m')).toBeCloseTo(10 / 3);
    expect(evalExpr<number>('n % m')).toBe(10 % 3);
  });

  it('honors operator precedence and parentheses', () => {
    expect(evalExpr<number>('1 + 2 * 3')).toBe(1 + 2 * 3);
    expect(evalExpr<number>('(1 + 2) * 3')).toBe((1 + 2) * 3);
    expect(evalExpr<number>('(n + m) * (n - m)')).toBe((10 + 3) * (10 - 3));
  });

  it('handles unary minus', () => {
    expect(evalExpr<number>('-n')).toBe(-10);
    expect(evalExpr<number>('-(n - m)')).toBe(-(10 - 3));
  });

  it('evaluates comparison operators', () => {
    expect(evalExpr<boolean>('n == 10')).toBe(true);
    expect(evalExpr<boolean>('n != 10')).toBe(false);
    expect(evalExpr<boolean>('n > m')).toBe(true);
    expect(evalExpr<boolean>('n >= 10')).toBe(true);
    expect(evalExpr<boolean>('n < m')).toBe(false);
    expect(evalExpr<boolean>('n <= 10')).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// Logical operators & short-circuit behavior
// -----------------------------------------------------------------------------

describe('Evaluator – logical operators & short-circuiting', () => {
  it('evaluates logical operators on booleans', () => {
    expect(evalExpr<boolean>('true && true')).toBe(true);
    expect(evalExpr<boolean>('true && false')).toBe(false);
    expect(evalExpr<boolean>('true || false')).toBe(true);
    expect(evalExpr<boolean>('false || false')).toBe(false);
    expect(evalExpr<boolean>('!true')).toBe(false);
    expect(evalExpr<boolean>('!false')).toBe(true);
  });

  it('short-circuits && and does not evaluate the right side when left is false', () => {
    const engine = createEngine().withFunction('boom', () => {
      throw new Error('should-not-be-called');
    });

    const expr = 'false && boom()';
    const compiled = engine.compile<EvalCtx, boolean>(expr);

    // If short-circuit is implemented, this should NOT throw.
    const result = compiled.eval(baseCtx);
    expect(result).toBe(false);
  });

  it('short-circuits || and does not evaluate the right side when left is true', () => {
    const engine = createEngine().withFunction('boom', () => {
      throw new Error('should-not-be-called');
    });

    const expr = 'true || boom()';
    const compiled = engine.compile<EvalCtx, boolean>(expr);

    const result = compiled.eval(baseCtx);
    expect(result).toBe(true);
  });

  it('supports mixing logical and comparison operators', () => {
    const expr = 'n > m && user.age >= 18 && user.country == "US"';
    const result = evalExpr<boolean>(expr);
    expect(result).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// Ternary operator semantics
// -----------------------------------------------------------------------------

describe('Evaluator – ternary operator', () => {
  it('chooses the correct branch based on condition', () => {
    expect(evalExpr<string>('flag ? "yes" : "no"')).toBe('yes');
    expect(evalExpr<string>('!flag ? "yes" : "no"', {
      ...baseCtx,
      flag: false,
    })).toBe('yes');
  });

  it('supports nested ternaries', () => {
    const expr =
      'user.age < 18 ? "child" : user.age < 30 ? "young-adult" : "adult"';
    const label = evalExpr<string>(expr);
    expect(label).toBe('young-adult');
  });

  it('combines ternary with arithmetic', () => {
    const expr = 'user.premium ? n * 2 : n * 0.5';
    const val = evalExpr<number>(expr);
    expect(val).toBe(20);
  });
});

// -----------------------------------------------------------------------------
// Member access & array indexing
// -----------------------------------------------------------------------------

describe('Evaluator – member access & arrays', () => {
  it('reads nested object properties', () => {
    expect(evalExpr<string>('user.name')).toBe('Alice');
    expect(evalExpr<number>('user.age')).toBe(21);
    expect(evalExpr<string>('user.country')).toBe('US');
  });

  it('supports optional-ish properties (missing values)', () => {
    const ctx: EvalCtx = {
      ...baseCtx,
      user: { ...baseCtx.user, country: undefined },
    };

    // Behavior here is implementation-dependent; many engines return `undefined`.
    // We accept either undefined or a defined-but-falsy value, but we do
    // assert that it does NOT throw.
    let caught: unknown;
    let value: unknown;
    try {
      value = evalExpr<unknown>('user.country', ctx);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeUndefined();
    // Just sanity check that evaluation returned *something* without throwing
    expect(value).toBeUndefined();
  });

  it('indexes into arrays safely', () => {
    expect(evalExpr<number>('items[0]')).toBe(1);
    expect(evalExpr<number>('items[1]')).toBe(2);
    expect(evalExpr<number>('items[2]')).toBe(3);
  });

  it('returns undefined or a safe value for out-of-bounds array access', () => {
    let caught: unknown;
    let value: unknown;
    try {
      value = evalExpr<unknown>('items[10]');
    } catch (err) {
      caught = err;
    }

    // Implementation may choose to return undefined or throw a controlled error.
    if (caught) {
      expect(caught).toBeDefined();
    } else {
      expect(value).toBeUndefined();
    }
  });

  it('combines member access, arrays, and arithmetic', () => {
    const expr = 'items[0] + items[1] * 2 + user.age';
    const expected = baseCtx.items[0] + baseCtx.items[1] * 2 + baseCtx.user.age;
    expect(evalExpr<number>(expr)).toBe(expected);
  });
});

// -----------------------------------------------------------------------------
// Function calls & error propagation
// -----------------------------------------------------------------------------

describe('Evaluator – function calls', () => {
  const engine = createEngine()
    .withFunction('max', (a: number, b: number) => Math.max(a, b))
    .withFunction('min', (a: number, b: number) => Math.min(a, b))
    .withFunction('round2', (x: number) => Math.round(x * 100) / 100)
    .withFunction(
      'ageBand',
      (age: number): string =>
        age < 18 ? 'child' : age < 30 ? 'young-adult' : 'adult',
    );

  it('evaluates simple numeric function calls', () => {
    const expr = 'max(n, m) + min(n, m)';
    const compiled = engine.compile<EvalCtx, number>(expr);

    const result = compiled.eval(baseCtx);
    expect(result).toBe(Math.max(baseCtx.n, baseCtx.m) + Math.min(baseCtx.n, baseCtx.m));
  });

  it('allows functions inside ternary conditions', () => {
    const expr = 'ageBand(user.age) == "young-adult" ? "ok" : "error"';
    const compiled = engine.compile<EvalCtx, string>(expr);
    expect(compiled.eval(baseCtx)).toBe('ok');
  });

  it('propagates errors thrown inside custom functions', () => {
    const throwingEngine = createEngine().withFunction('boom', () => {
      throw new Error('boom');
    });

    const expr = 'boom()';
    const compiled = throwingEngine.compile<EvalCtx, unknown>(expr);

    let caught: unknown;
    try {
      compiled.eval(baseCtx);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
    // Implementation may either wrap in SafexprError or propagate original error.
  });

  it('fails when calling unknown functions (no implicit global resolution)', () => {
    const engineNoFns = createEngine();
    const expr = 'unknownFn(n)';

    let caught: unknown;
    try {
      const compiled = engineNoFns.compile<EvalCtx, unknown>(expr);
      compiled.eval(baseCtx);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
  });
});

// -----------------------------------------------------------------------------
// Error handling & diagnostics
// -----------------------------------------------------------------------------

describe('Evaluator – error handling & SafexprError', () => {
  it('throws SafexprError on invalid syntax at compile time', () => {
    const expr = 'n * * m';

    let caught: unknown;
    try {
      const fn = compile<EvalCtx, number>(expr);
      fn.eval(baseCtx);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(SafexprError);
    const se = caught as SafexprError;

    expect(typeof se.message).toBe('string');
    expect(typeof se.column).toBe('number');
    expect(typeof se.snippet).toBe('string');
  });

  it('provides a useful snippet pointing near the error location', () => {
    const expr = 'user.age > 18 && && flag'; // double &&

    let caught: unknown;
    try {
      const fn = compile<EvalCtx, boolean>(expr);
      fn.eval(baseCtx);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(SafexprError);
    const se = caught as SafexprError;

    // We don't assert exact formatting but we expect some visual snippet.
    expect(se.snippet.length).toBeGreaterThan(0);
  });
});

// -----------------------------------------------------------------------------
// Safety around dangerous property access (high level)
// -----------------------------------------------------------------------------

describe('Evaluator – high-level safety for dangerous properties', () => {
  const dangerousExpressions = [
    'user.__proto__',
    'user.constructor',
    'user.constructor.prototype',
  ];

  for (const expr of dangerousExpressions) {
    it(`rejects dangerous member access pattern: ${expr}`, () => {
      let caught: unknown;
      try {
        evalExpr<unknown>(expr);
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeDefined();
    });
  }

  it('still allows access to safe fields next to dangerous ones', () => {
    const ctx: EvalCtx = {
      ...baseCtx,
      user: { ...baseCtx.user, name: 'Bob' },
    };

    const name = evalExpr<string>('user.name', ctx);
    expect(name).toBe('Bob');
  });
});

// -----------------------------------------------------------------------------
// Coherence between multiple evaluations
// -----------------------------------------------------------------------------

describe('Evaluator – determinism & context immutability', () => {
  it('does not mutate the context while evaluating', () => {
    const engine = createEngine();
    const expr = 'n + m + user.age';

    const compiled = engine.compile<EvalCtx, number>(expr);
    const ctx: EvalCtx = JSON.parse(JSON.stringify(baseCtx));

    const snapshot = JSON.parse(JSON.stringify(ctx));
    const value = compiled.eval(ctx);

    expect(value).toBe(ctx.n + ctx.m + ctx.user.age);
    expect(ctx).toEqual(snapshot);
  });

  it('is deterministic for pure expressions and identical contexts', () => {
    const expr = 'n * 2 + m - user.age';

    const ctx1: EvalCtx = JSON.parse(JSON.stringify(baseCtx));
    const ctx2: EvalCtx = JSON.parse(JSON.stringify(baseCtx));

    const v1 = evalExpr<number>(expr, ctx1);
    const v2 = evalExpr<number>(expr, ctx2);

    expect(v1).toBe(v2);
  });
});
