// SafExpr/tests/security/dos-limits.spec.ts
//
// Security-focused tests for denial-of-service (DoS) protections in Safexpr.
//
// These tests are *aspirational*: they describe expected behavior for a
// safe expression engine that exposes configurable limits, such as:
//
//   - maxExpressionLength:   maximum allowed source length.
//   - maxAstDepth:           maximum allowed AST depth / nesting.
//   - maxEvalOperations:     (optional) upper bound on evaluation steps.
//
// If your current implementation does not yet support these options,
// treat these tests as a specification and adjust them as the limits
// API evolves.
//
// The main goals:
//  - Large or deeply nested expressions should be rejected early.
//  - Evaluation of very “wide” expressions should be bounded.
//  - Reasonable expressions should still succeed.

import { describe, it, expect } from 'vitest';
import { compile, createEngine, SafexprError } from '../../src';

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

type SimpleContext = {
  value: number;
};

// Build a long but syntactically simple arithmetic expression:
//
//   "1 + 1 + 1 + ... + 1" (count times)
//
// This simulates user input with very large length.
function buildLongExpression(count: number): string {
  if (count <= 0) return '0';
  return Array.from({ length: count }, () => '1').join(' + ');
}

// Build a deeply nested expression:
//
//   "((((1 + 1) + 1) + 1) ... )"
//
// depth is the number of nested parentheses.
function buildDeepNestedExpression(depth: number): string {
  let expr = '1';
  for (let i = 0; i < depth; i++) {
    expr = `(${expr} + 1)`;
  }
  return expr;
}

// Build a “wide” logical chain:
//
//   "true && true && ... && true" (count terms)
function buildWideLogicalChain(count: number): string {
  if (count <= 0) return 'true';
  return Array.from({ length: count }, () => 'true').join(' && ');
}

// A minimal helper: compile and eval with a simple context.
function evalExpr(expression: string, value = 1): number {
  const fn = compile<SimpleContext, number>(expression);
  return fn.eval({ value });
}

// -----------------------------------------------------------------------------
// Tests: maxExpressionLength
// -----------------------------------------------------------------------------

describe('Security – DoS: maxExpressionLength', () => {
  it('rejects overly long expressions when maxExpressionLength is enforced', () => {
    const longExpr = buildLongExpression(10_000); // a lot of tokens
    const shortExpr = buildLongExpression(50);

    // Engine with a strict length limit (example API).
    const engine = createEngine({
      maxExpressionLength: 2_000,
    });

    // Short expression should be fine.
    const okFn = engine.compile<SimpleContext, number>(shortExpr);
    expect(okFn.eval({ value: 1 })).toBeGreaterThan(0);

    // Long expression should fail fast.
    let caught: unknown;
    try {
      engine.compile<SimpleContext, number>(longExpr);
    } catch (err) {
      caught = err;
    }

    // We only assert that some error is thrown; implementation can use
    // SafexprError or a different error type as long as it is explicit.
    expect(caught).toBeDefined();
  });

  it('allows reasonably long expressions under safe defaults', () => {
    const expr = buildLongExpression(500); // large but not extreme

    // Default compile should handle moderately large expressions without
    // excessive slowdown or stack usage.
    const result = evalExpr(expr);
    expect(result).toBe(500);
  });
});

// -----------------------------------------------------------------------------
// Tests: maxAstDepth (nesting limits)
// -----------------------------------------------------------------------------

describe('Security – DoS: maxAstDepth / nesting', () => {
  it('rejects excessively deep nesting when maxAstDepth is enforced', () => {
    const shallow = buildDeepNestedExpression(20);
    const deep = buildDeepNestedExpression(300);

    const engine = createEngine({
      maxAstDepth: 64, // example limit
    });

    // Shallow expression should work.
    const shallowFn = engine.compile<SimpleContext, number>(shallow);
    const shallowResult = shallowFn.eval({ value: 1 });
    expect(shallowResult).toBe(21); // 1 + 20

    // Deeply nested expression should be rejected early.
    let caught: unknown;
    try {
      engine.compile<SimpleContext, number>(deep);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
    // If you want stricter behavior, you can assert SafexprError specifically:
    // expect(caught).toBeInstanceOf(SafexprError);
  });

  it('handles moderate nesting depth without stack overflow', () => {
    const expr = buildDeepNestedExpression(40);
    const result = evalExpr(expr);
    expect(result).toBe(41);
  });
});

// -----------------------------------------------------------------------------
// Tests: maxEvalOperations (optional evaluation step bounding)
// -----------------------------------------------------------------------------

describe('Security – DoS: maxEvalOperations', () => {
  it('evaluates wide logical chains safely when limits are generous', () => {
    const expr = buildWideLogicalChain(2_000);

    const engine = createEngine({
      maxEvalOperations: 10_000, // high enough to allow this expression
    });

    const fn = engine.compile<SimpleContext, boolean>(expr);
    const result = fn.eval({ value: 1 });

    expect(result).toBe(true);
  });

  it('rejects evaluation when expression would exceed maxEvalOperations', () => {
    const expr = buildWideLogicalChain(50_000);

    const engine = createEngine({
      maxEvalOperations: 5_000,
    });

    const fn = engine.compile<SimpleContext, boolean>(expr);

    let caught: unknown;
    try {
      fn.eval({ value: 1 });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
  });

  it('does not break simple expressions when limits are enabled', () => {
    const engine = createEngine({
      maxExpressionLength: 1_000,
      maxAstDepth: 64,
      maxEvalOperations: 10_000,
    });

    const expr = 'value * 2 + 3';
    const fn = engine.compile<SimpleContext, number>(expr);
    const result = fn.eval({ value: 10 });

    expect(result).toBe(23);
  });
});

// -----------------------------------------------------------------------------
// Tests: resilience to user-controlled input
// -----------------------------------------------------------------------------

describe('Security – DoS: resilience to hostile-looking input', () => {
  it('fails fast on absurdly long single-line input', () => {
    const base = 'value + 1';
    const repeated = Array.from({ length: 100_000 }, () => base).join(' + ');

    let caught: unknown;
    try {
      // Assuming compile() uses the same internal limits as createEngine()
      // or enforces its own safe defaults.
      compile<SimpleContext, number>(repeated);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
  });

  it('provides meaningful diagnostics for limit-related errors', () => {
    const expr = buildDeepNestedExpression(500); // intentionally too deep
    const engine = createEngine({
      maxAstDepth: 64,
    });

    let caught: unknown;
    try {
      engine.compile<SimpleContext, number>(expr);
    } catch (err) {
      caught = err;
    }

    // Optional but nice: if your implementation uses SafexprError
    // for limit violations, you get better DX.
    if (caught instanceof SafexprError) {
      expect(typeof caught.message).toBe('string');
      expect(caught.message.toLowerCase()).toContain('depth');
    } else {
      expect(caught).toBeDefined();
    }
  });
});
