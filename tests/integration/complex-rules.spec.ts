// SafExpr/tests/integration/complex-rules.spec.ts
//
// Integration tests for complex, realistic business rules built with Safexpr.
//
// These tests focus on:
//  - End-to-end behavior: parse + evaluate + engine configuration.
//  - Realistic rule sets: discounts, segmentation, risk scoring.
//  - Reusing benchmark expression cases for sanity checking.
//

import { describe, it, expect } from 'vitest';
import { compile, createEngine, SafexprError } from '../../src';
import {
  DEFAULT_BENCHMARK_CONTEXT,
  EXPRESSION_CASES,
  verifyExpressionCase,
  type ExpressionBenchmarkContext,
} from '../../benchmarks/expression-cases';

// -----------------------------------------------------------------------------
// Types used in this file
// -----------------------------------------------------------------------------

type User = {
  id: string;
  age: number;
  country: string;
  premium: boolean;
  segment?: 'A' | 'B' | 'C';
};

type Order = {
  id: string;
  subtotal: number;
  shipping: number;
  taxRate: number;
};

type SegmentConfig = {
  id: string;
  minAge: number;
  countries: string[];
  premiumOnly: boolean;
};

type ComplexContext = {
  user: User;
  order: Order;
  segments: SegmentConfig[];
  flags: {
    experimentalPricing: boolean;
  };
};

// -----------------------------------------------------------------------------
// Shared helpers
// -----------------------------------------------------------------------------

function buildBaseContext(): ComplexContext {
  return {
    user: {
      id: 'user-123',
      age: 27,
      country: 'US',
      premium: true,
      segment: 'A',
    },
    order: {
      id: 'order-456',
      subtotal: 150,
      shipping: 10,
      taxRate: 0.2,
    },
    segments: [
      {
        id: 'A',
        minAge: 18,
        countries: ['US', 'CA'],
        premiumOnly: false,
      },
      {
        id: 'B',
        minAge: 25,
        countries: ['DE', 'FR'],
        premiumOnly: true,
      },
      {
        id: 'C',
        minAge: 21,
        countries: ['US', 'GB'],
        premiumOnly: false,
      },
    ],
    flags: {
      experimentalPricing: true,
    },
  };
}

// For numeric comparisons with floating point operations
function almostEqual(a: number, b: number, epsilon = 1e-6): boolean {
  return Math.abs(a - b) <= epsilon;
}

// -----------------------------------------------------------------------------
// Engine factory for complex rules
// -----------------------------------------------------------------------------

/**
 * Build a shared Engine instance with a few useful helper functions.
 *
 * NOTE: In real applications you might keep this engine singleton
 * and reuse it across many evaluations.
 */
function createComplexEngine() {
  return createEngine()
    // Compute discount for a user + subtotal, based on premium + thresholds.
    .withFunction(
      'discountFor',
      (subtotal: number, premium: boolean, experimental: boolean): number => {
        if (!experimental) {
          // Simple rule: 10% for premium if subtotal >= 100
          return premium && subtotal >= 100 ? subtotal * 0.1 : 0;
        }

        // Experimental pricing:
        //  - >= 200 and premium -> 20%
        //  - >= 100 and premium -> 12%
        //  - otherwise, 0
        if (premium && subtotal >= 200) return subtotal * 0.2;
        if (premium && subtotal >= 100) return subtotal * 0.12;
        return 0;
      },
    )
    // Simple "is user in segment" helper, based on a minimal view of segments.
    // NOTE: The full `segments` array is part of the context,
    // so the expression itself might still implement its own logic if desired.
    .withFunction(
      'isInSegment',
      (userSegment: string | null, wanted: string): boolean =>
        !!userSegment && userSegment === wanted,
    )
    // "riskScore" helper: given user age and country and order subtotal.
    .withFunction(
      'riskScoreBase',
      (age: number, country: string, subtotal: number): number => {
        let score = 0;

        // Younger users might be slightly higher risk
        if (age < 21) score += 10;
        else if (age < 30) score += 5;

        // Certain countries might add or remove points (synthetic example)
        if (country === 'US' || country === 'DE') score += 2;
        else score += 5;

        // High-value orders add risk
        if (subtotal > 200) score += 15;
        else if (subtotal > 100) score += 8;

        return score;
      },
    )
    // Simple rounding helper
    .withFunction('round2', (value: number): number => Math.round(value * 100) / 100);
}

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

describe('Complex business rules (Safexpr integration)', () => {
  it('computes a tiered discount and final total with a straight expression', () => {
    const ctx = buildBaseContext();

    // Tiered discount logic, pure expression:
    //  - If experimentalPricing:
    //      subtotal >= 200 && premium -> 20%
    //      subtotal >= 100 && premium -> 12%
    //  - Else:
    //      subtotal >= 100 && premium -> 10%
    //  - Otherwise, no discount.
    //
    // Then compute final total = (subtotal - discount + shipping) * (1 + taxRate)
    const expression = `
      (
        flags.experimentalPricing
          ? (
              user.premium && order.subtotal >= 200
                ? order.subtotal * 0.20
                : user.premium && order.subtotal >= 100
                  ? order.subtotal * 0.12
                  : 0
            )
          : (
              user.premium && order.subtotal >= 100
                ? order.subtotal * 0.10
                : 0
            )
      ) as discount,
      (order.subtotal - discount + order.shipping) * (1 + order.taxRate)
    `;

    // The above uses a pseudo "discount" for readability; for a minimal
    // Safexpr implementation you might instead build this as two separate
    // expressions or use a plugin-like approach. For the purpose of this spec
    // we keep the expression simpler and only compute the numeric total:
    const simplifiedExpression = `
      (
        order.subtotal -
        (
          flags.experimentalPricing
            ? (
                user.premium && order.subtotal >= 200
                  ? order.subtotal * 0.20
                  : user.premium && order.subtotal >= 100
                    ? order.subtotal * 0.12
                    : 0
              )
            : (
                user.premium && order.subtotal >= 100
                  ? order.subtotal * 0.10
                  : 0
              )
        ) +
        order.shipping
      ) * (1 + order.taxRate)
    `;

    const compiled = compile<ComplexContext, number>(simplifiedExpression);
    const result = compiled.eval(ctx);

    // Compute expected result in plain TypeScript
    const discount = ctx.flags.experimentalPricing
      ? ctx.user.premium && ctx.order.subtotal >= 200
        ? ctx.order.subtotal * 0.2
        : ctx.user.premium && ctx.order.subtotal >= 100
          ? ctx.order.subtotal * 0.12
          : 0
      : ctx.user.premium && ctx.order.subtotal >= 100
        ? ctx.order.subtotal * 0.1
        : 0;

    const expected =
      (ctx.order.subtotal - discount + ctx.order.shipping) * (1 + ctx.order.taxRate);

    expect(almostEqual(result, expected)).toBe(true);
  });

  it('uses a shared engine with helper functions to compute complex totals', () => {
    const ctx = buildBaseContext();
    const engine = createComplexEngine();

    // Expression using helper functions:
    //   discountFor(subtotal, premium, flags.experimentalPricing)
    //   riskScoreBase(user.age, user.country, order.subtotal)
    //
    // And then a synthetic "dynamic pricing" rule:
    //   If risk score > 25, add a small fee (e.g. 1.5% of subtotal).
    //
    const expression = `
      round2(
        (
          order.subtotal
          - discountFor(order.subtotal, user.premium, flags.experimentalPricing)
          + order.shipping
        ) * (1 + order.taxRate)
        + (
          riskScoreBase(user.age, user.country, order.subtotal) > 25
            ? order.subtotal * 0.015
            : 0
        )
      )
    `;

    const compiled = engine.compile<ComplexContext, number>(expression);
    const value = compiled.eval(ctx);

    // Compute expected value in plain TypeScript, replicating the logic
    const discount = ctx.flags.experimentalPricing
      ? ctx.user.premium && ctx.order.subtotal >= 200
        ? ctx.order.subtotal * 0.2
        : ctx.user.premium && ctx.order.subtotal >= 100
          ? ctx.order.subtotal * 0.12
          : 0
      : ctx.user.premium && ctx.order.subtotal >= 100
        ? ctx.order.subtotal * 0.1
        : 0;

    const riskScoreBase = (() => {
      let score = 0;
      const { age, country } = ctx.user;
      const subtotal = ctx.order.subtotal;

      if (age < 21) score += 10;
      else if (age < 30) score += 5;

      if (country === 'US' || country === 'DE') score += 2;
      else score += 5;

      if (subtotal > 200) score += 15;
      else if (subtotal > 100) score += 8;

      return score;
    })();

    const riskFee = riskScoreBase > 25 ? ctx.order.subtotal * 0.015 : 0;

    const expectedRaw =
      (ctx.order.subtotal - discount + ctx.order.shipping) * (1 + ctx.order.taxRate) +
      riskFee;
    const expected = Math.round(expectedRaw * 100) / 100;

    expect(almostEqual(value, expected)).toBe(true);
  });

  it('supports segmentation-style rules in expressions', () => {
    const ctx = buildBaseContext();
    const engine = createComplexEngine();

    // Synthetic segmentation rule:
    //
    //   - If user is in segment A and premium -> label "A-premium"
    //   - Else if country == "US" and age >= 25 -> "US-25+"
    //   - Else -> "other"
    //
    const expression = `
      isInSegment(user.segment, "A") && user.premium
        ? "A-premium"
        : (user.country == "US" && user.age >= 25
            ? "US-25+"
            : "other"
          )
    `;

    const compiled = engine.compile<ComplexContext, string>(expression);
    const label = compiled.eval(ctx);

    expect(label).toBe('A-premium');

    // Non-premium user in segment A
    const ctx2: ComplexContext = {
      ...ctx,
      user: { ...ctx.user, premium: false },
    };
    const label2 = compiled.eval(ctx2);
    expect(label2).toBe('US-25+');

    // Different country
    const ctx3: ComplexContext = {
      ...ctx,
      user: { ...ctx.user, country: 'DE' },
    };
    const label3 = compiled.eval(ctx3);
    expect(label3).toBe('other');
  });

  it('propagates SafexprError with useful diagnostics for invalid syntax', () => {
    const ctx = buildBaseContext();
    const invalidExpression = 'order.subtotal * * 2'; // invalid syntax

    let caught: unknown;
    try {
      const compiled = compile<ComplexContext, number>(invalidExpression);
      compiled.eval(ctx); // should not get here
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(SafexprError);
    const safexprError = caught as SafexprError;

    expect(typeof safexprError.message).toBe('string');
    // We expect at least column and snippet to be present for DX
    expect(typeof safexprError.column).toBe('number');
    expect(typeof safexprError.snippet).toBe('string');
  });

  it('rejects access to globals or dangerous properties in complex expressions', () => {
    const ctx = buildBaseContext();

    const expressions = [
      'global.process.env',
      'process.env',
      'this.constructor.constructor("return process")()',
      'user.__proto__',
      'order.constructor.prototype',
    ];

    for (const expr of expressions) {
      let caught: unknown;
      try {
        const compiled = compile<ComplexContext, unknown>(expr);
        compiled.eval(ctx);
      } catch (err) {
        caught = err;
      }

      // Depending on implementation details, this may be a SafexprError (parse/runtime)
      // or a generic error. We only assert that evaluating such expressions is not allowed.
      expect(caught).toBeDefined();
    }
  });
});

// -----------------------------------------------------------------------------
// Integration with benchmark expression cases
// -----------------------------------------------------------------------------

describe('Complex rules – benchmark expression cases', () => {
  it('evaluates all EXPRESSION_CASES consistently with engine.compile', () => {
    const engine = createComplexEngine();
    const baseContext: ExpressionBenchmarkContext = DEFAULT_BENCHMARK_CONTEXT;

    for (const exprCase of EXPRESSION_CASES) {
      const compiled = engine.compile<ExpressionBenchmarkContext, unknown>(
        exprCase.expression,
      );

      const result = verifyExpressionCase(exprCase, (expression, ctx) => {
        // ignore "expression" here since we already compiled; this is just
        // to keep verifyExpressionCase signature consistent
        return compiled.eval(ctx);
      }, baseContext);

      expect(result.ok).toBe(true);
      if (typeof exprCase.expected !== 'undefined') {
        expect(result.actual).toBe(result.expected);
      }
    }
  });

  it('evaluates all EXPRESSION_CASES consistently with one-off compile', () => {
    const baseContext: ExpressionBenchmarkContext = DEFAULT_BENCHMARK_CONTEXT;

    for (const exprCase of EXPRESSION_CASES) {
      const result = verifyExpressionCase(exprCase, (expression, ctx) => {
        const compiled = compile<ExpressionBenchmarkContext, unknown>(expression);
        return compiled.eval(ctx);
      }, baseContext);

      expect(result.ok).toBe(true);
      if (typeof exprCase.expected !== 'undefined') {
        expect(result.actual).toBe(result.expected);
      }
    }
  });
});
