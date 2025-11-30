// SafExpr/tests/unit/engine.spec.ts
//
// Unit tests for the Safexpr engine.
//
// Focus areas:
//  - Basic engine creation and compilation.
//  - Reusability: compile once, evaluate many times with different contexts.
//  - Custom functions registration via `withFunction` and chaining.
//  - Error handling for unknown functions and invalid expressions.
//  - (Aspirational) engine options such as maxExpressionLength / maxAstDepth.
//
// These tests act both as verification and as a specification
// of how `createEngine` and `compile` are expected to behave.

import { describe, it, expect } from 'vitest';
import { createEngine, compile, SafexprError } from '../../src';

// -----------------------------------------------------------------------------
// Shared types & helpers
// -----------------------------------------------------------------------------

type Ctx = {
  a: number;
  b: number;
  user: {
    id: string;
    tier: 'free' | 'pro' | 'enterprise';
  };
};

const baseCtx: Ctx = {
  a: 5,
  b: 3,
  user: {
    id: 'u1',
    tier: 'pro',
  },
};

function evalWithGlobalCompile<R = unknown>(
  expression: string,
  ctx: Ctx = baseCtx,
): R {
  const compiled = compile<Ctx, R>(expression);
  return compiled.eval(ctx);
}

// -----------------------------------------------------------------------------
// Engine – basic behavior
// -----------------------------------------------------------------------------

describe('Engine – basic behavior', () => {
  it('creates an engine and compiles a simple expression', () => {
    const engine = createEngine();
    const expr = 'a + b * 2';

    const compiled = engine.compile<Ctx, number>(expr);

    // Basic shape
    expect(compiled).toBeDefined();
    expect(typeof compiled.eval).toBe('function');

    const result = compiled.eval(baseCtx);
    expect(result).toBe(baseCtx.a + baseCtx.b * 2);
  });

  it('produces the same result as global compile() for the same expression', () => {
    const engine = createEngine();
    const expression = 'a * 10 + b';

    const compiledEngine = engine.compile<Ctx, number>(expression);
    const compiledGlobal = compile<Ctx, number>(expression);

    const ctx1: Ctx = {
      ...baseCtx,
      a: 2,
      b: 1,
    };
    const ctx2: Ctx = {
      ...baseCtx,
      a: 7,
      b: 4,
    };

    expect(compiledEngine.eval(ctx1)).toBe(compiledGlobal.eval(ctx1));
    expect(compiledEngine.eval(ctx2)).toBe(compiledGlobal.eval(ctx2));
  });

  it('allows reusing the same compiled expression with different contexts', () => {
    const engine = createEngine();
    const expression = 'a + b';

    const compiled = engine.compile<Ctx, number>(expression);

    const c1: Ctx = { ...baseCtx, a: 1, b: 2 };
    const c2: Ctx = { ...baseCtx, a: 10, b: 20 };

    expect(compiled.eval(c1)).toBe(3);
    expect(compiled.eval(c2)).toBe(30);
  });

  it('throws a SafexprError for syntactically invalid expressions', () => {
    const engine = createEngine();
    const invalid = 'a * * b';

    let caught: unknown;
    try {
      const compiled = engine.compile<Ctx, number>(invalid);
      compiled.eval(baseCtx);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(SafexprError);
    const se = caught as SafexprError;
    expect(typeof se.message).toBe('string');
    expect(typeof se.column).toBe('number');
    expect(typeof se.snippet).toBe('string');
  });
});

// -----------------------------------------------------------------------------
// Engine – custom functions
// -----------------------------------------------------------------------------

describe('Engine – custom functions', () => {
  it('registers a single custom function and calls it from expressions', () => {
    const engine = createEngine().withFunction(
      'double',
      (x: number): number => x * 2,
    );

    const expr = 'double(a + b)';

    const compiled = engine.compile<Ctx, number>(expr);
    const result = compiled.eval(baseCtx);

    expect(result).toBe((baseCtx.a + baseCtx.b) * 2);
  });

  it('supports chaining withFunction to register multiple helpers', () => {
    const engine = createEngine()
      .withFunction('max', (x: number, y: number) => Math.max(x, y))
      .withFunction('min', (x: number, y: number) => Math.min(x, y))
      .withFunction(
        'tierWeight',
        (tier: string): number =>
          tier === 'free' ? 1 : tier === 'pro' ? 2 : 3,
      );

    const expr = 'max(a, b) + min(a, b) * tierWeight(user.tier)';
    const compiled = engine.compile<Ctx, number>(expr);

    const ctx: Ctx = {
      ...baseCtx,
      a: 4,
      b: 2,
      user: { id: 'u2', tier: 'enterprise' },
    };

    // max(4,2) + min(4,2)*tierWeight("enterprise") => 4 + 2*3 = 10
    const result = compiled.eval(ctx);
    expect(result).toBe(10);
  });

  it('reuses the same engine instance across multiple compilations', () => {
    const engine = createEngine().withFunction(
      'inc',
      (x: number): number => x + 1,
    );

    const expr1 = 'inc(a)';
    const expr2 = 'inc(a + b)';

    const compiled1 = engine.compile<Ctx, number>(expr1);
    const compiled2 = engine.compile<Ctx, number>(expr2);

    const ctx1: Ctx = { ...baseCtx, a: 1, b: 1 };
    const ctx2: Ctx = { ...baseCtx, a: 10, b: 5 };

    expect(compiled1.eval(ctx1)).toBe(2);
    expect(compiled2.eval(ctx1)).toBe(3);

    expect(compiled1.eval(ctx2)).toBe(11);
    expect(compiled2.eval(ctx2)).toBe(16);
  });

  it('fails when calling an unknown function from an expression', () => {
    const engine = createEngine();
    const expr = 'unknownFn(a, b)';

    let caught: unknown;
    try {
      const compiled = engine.compile<Ctx, number>(expr);
      compiled.eval(baseCtx);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
    // If implementation uses SafexprError for unknown functions:
    // expect(caught).toBeInstanceOf(SafexprError);
  });
});

// -----------------------------------------------------------------------------
// Engine – configuration / options (aspirational spec)
// -----------------------------------------------------------------------------

describe('Engine – configuration options (aspirational)', () => {
  it('accepts basic safety options like maxExpressionLength', () => {
    const engine = createEngine({
      maxExpressionLength: 100,
    } as any);

    const safe = 'a + b * 2';
    const compiledSafe = engine.compile<Ctx, number>(safe);
    expect(compiledSafe.eval(baseCtx)).toBe(11);

    const tooLong = '1 + '.repeat(200) + '1';

    let caught: unknown;
    try {
      engine.compile<Ctx, number>(tooLong);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
  });

  it('accepts maxAstDepth and rejects overly nested expressions', () => {
    const engine = createEngine({
      maxAstDepth: 32,
    } as any);

    // Moderately nested – should pass
    const okExpr = '((((a + b) + 1) + 2) + 3)';
    const compiledOk = engine.compile<Ctx, number>(okExpr);
    const resultOk = compiledOk.eval(baseCtx);
    expect(resultOk).toBe((((baseCtx.a + baseCtx.b) + 1) + 2) + 3);

    // Deeply nested – should fail
    let expr = 'a';
    for (let i = 0; i < 200; i++) {
      expr = `(${expr} + 1)`;
    }

    let caught: unknown;
    try {
      engine.compile<Ctx, number>(expr);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
  });

  it('can be used without any options (safe defaults)', () => {
    const engine = createEngine(); // no options
    const expr = 'a * 3 + b';

    const compiled = engine.compile<Ctx, number>(expr);
    const value = compiled.eval(baseCtx);

    expect(value).toBe(baseCtx.a * 3 + baseCtx.b);
  });
});

// -----------------------------------------------------------------------------
// Engine – error diagnostics
// -----------------------------------------------------------------------------

describe('Engine – error diagnostics', () => {
  it('surface parse errors with message, column and snippet', () => {
    const engine = createEngine();
    const invalid = 'a + (b *';

    let caught: unknown;
    try {
      const compiled = engine.compile<Ctx, number>(invalid);
      compiled.eval(baseCtx);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(SafexprError);
    const se = caught as SafexprError;

    expect(typeof se.message).toBe('string');
    expect(typeof se.column).toBe('number');
    expect(typeof se.snippet).toBe('string');
    expect(se.snippet.length).toBeGreaterThan(0);
  });

  it('optionally uses SafexprError for runtime errors from functions', () => {
    const engine = createEngine().withFunction('unsafe', () => {
      throw new Error('boom');
    });

    const expr = 'unsafe()';
    const compiled = engine.compile<Ctx, unknown>(expr);

    let caught: unknown;
    try {
      compiled.eval(baseCtx);
    } catch (err) {
      caught = err;
    }

    // Implementation may either:
    //  - Wrap the original error into SafexprError, or
    //  - Re-throw the original error.
    //
    // We only assert that the error is not silently swallowed.
    expect(caught).toBeDefined();
  });
});

// -----------------------------------------------------------------------------
// Engine – misc behavior
// -----------------------------------------------------------------------------

describe('Engine – misc behavior', () => {
  it('does not mutate the original context object during evaluation', () => {
    const engine = createEngine().withFunction('sum', (x: number, y: number) => x + y);

    const expr = 'sum(a, b)';
    const compiled = engine.compile<Ctx, number>(expr);

    const ctx: Ctx = {
      a: 1,
      b: 2,
      user: { id: 'u-test', tier: 'free' },
    };

    const snapshot = JSON.parse(JSON.stringify(ctx));
    const result = compiled.eval(ctx);

    expect(result).toBe(3);
    expect(ctx).toEqual(snapshot);
  });

  it('allows multiple engine instances with different function sets', () => {
    const engine1 = createEngine().withFunction('mult', (x: number, y: number) => x * y);
    const engine2 = createEngine().withFunction('add', (x: number, y: number) => x + y);

    const expr1 = 'mult(a, b)';
    const expr2 = 'add(a, b)';

    const compiled1 = engine1.compile<Ctx, number>(expr1);
    const compiled2 = engine2.compile<Ctx, number>(expr2);

    expect(compiled1.eval(baseCtx)).toBe(baseCtx.a * baseCtx.b);
    expect(compiled2.eval(baseCtx)).toBe(baseCtx.a + baseCtx.b);
  });
});
