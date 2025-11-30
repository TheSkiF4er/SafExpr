/**
 * Safexpr/benchmarks/expression-cases.ts
 *
 * A curated set of realistic expression cases for benchmarking and manual testing.
 *
 * These are intended to:
 *  - Represent common business / product scenarios.
 *  - Cover a mix of arithmetic, logical, and property-access heavy expressions.
 *  - Be reusable across different benchmark scripts (e.g. compare-to-eval, engine micro-benchmarks).
 *
 * NOTE:
 *  - This file is for local development and benchmarking only.
 *  - It is NOT part of the public API of the Safexpr library.
 */

export type User = {
  id: string;
  age: number;
  country: string;
  premium: boolean;
  signupTimestamp: number; // epoch ms
};

export type Order = {
  id: string;
  total: number;
  items: number[];
  createdAt: number; // epoch ms
  currency: string;
};

export type FeatureFlags = {
  betaDiscounts: boolean;
  allowHighRiskCountry: boolean;
  vipBoost: boolean;
};

export type ExpressionBenchmarkContext = {
  price: number;
  qty: number;
  shipping: number;
  taxRate: number;

  user: User;
  order: Order;
  flags: FeatureFlags;

  // Some generic config values
  config: {
    minAge: number;
    highValueThreshold: number;
    maxItems: number;
  };
};

/**
 * A single expression benchmark case.
 *
 * C – context type
 * R – expected result type (when known / asserted)
 */
export interface ExpressionCase<C = ExpressionBenchmarkContext, R = unknown> {
  /** Human-readable name for the case. */
  name: string;
  /** Short description of what the expression models. */
  description: string;
  /** The actual expression string to evaluate. */
  expression: string;
  /**
   * Optional per-case context override.
   * If not provided, a default context can be used by the benchmark runner.
   */
  customContext?: Partial<C>;
  /**
   * Optional expected result for quick sanity checks.
   * If provided, the benchmark runner can assert correctness.
   */
  expected?: R;
  /**
   * Approximate number of iterations recommended for this case in micro-benchmarks.
   * Runners may override this if needed.
   */
  iterations?: number;
  /**
   * Category (e.g. "arithmetic", "logic", "mixed", "array", "heavy").
   */
  category: 'arithmetic' | 'logic' | 'mixed' | 'array' | 'conditional' | 'scoring' | 'other';
}

/**
 * A default context that can be reused in benchmarks.
 * Benchmark runners can use this as a base and override with case.customContext.
 */
export const DEFAULT_BENCHMARK_CONTEXT: ExpressionBenchmarkContext = {
  price: 19.99,
  qty: 3,
  shipping: 4.99,
  taxRate: 0.2,

  user: {
    id: 'user-123',
    age: 27,
    country: 'US',
    premium: true,
    signupTimestamp: 1_700_000_000_000,
  },

  order: {
    id: 'order-456',
    total: 199.5,
    items: [19.99, 49.0, 130.51],
    createdAt: 1_700_050_000_000,
    currency: 'USD',
  },

  flags: {
    betaDiscounts: true,
    allowHighRiskCountry: false,
    vipBoost: true,
  },

  config: {
    minAge: 18,
    highValueThreshold: 150,
    maxItems: 10,
  },
};

/**
 * A set of expression cases that can be used across benchmarks.
 *
 * Each expression is intentionally written in a way that is:
 *  - Non-trivial (more than a single operation),
 *  - Realistic for typical Safexpr usage,
 *  - Still understandable at-a-glance.
 */
export const EXPRESSION_CASES: ExpressionCase[] = [
  {
    name: 'Simple arithmetic total',
    category: 'arithmetic',
    description: 'Basic price calculation: subtotal + shipping + tax.',
    expression: 'price * qty + shipping + (price * qty) * taxRate',
    expected:
      DEFAULT_BENCHMARK_CONTEXT.price *
        DEFAULT_BENCHMARK_CONTEXT.qty +
      DEFAULT_BENCHMARK_CONTEXT.shipping +
      DEFAULT_BENCHMARK_CONTEXT.price *
        DEFAULT_BENCHMARK_CONTEXT.qty *
        DEFAULT_BENCHMARK_CONTEXT.taxRate,
    iterations: 250_000,
  },
  {
    name: 'Conditional premium discount',
    category: 'conditional',
    description:
      'Apply a discount if the user is premium; otherwise return the full order total.',
    expression: 'user.premium ? order.total * 0.9 : order.total',
    expected: DEFAULT_BENCHMARK_CONTEXT.user.premium
      ? DEFAULT_BENCHMARK_CONTEXT.order.total * 0.9
      : DEFAULT_BENCHMARK_CONTEXT.order.total,
    iterations: 200_000,
  },
  {
    name: 'High-value order flag',
    category: 'logic',
    description:
      'Determine if an order is high value and the user meets age and country conditions.',
    expression:
      'order.total >= config.highValueThreshold && user.age >= config.minAge && user.country == "US" ? 1 : 0',
    expected:
      DEFAULT_BENCHMARK_CONTEXT.order.total >=
        DEFAULT_BENCHMARK_CONTEXT.config.highValueThreshold &&
      DEFAULT_BENCHMARK_CONTEXT.user.age >=
        DEFAULT_BENCHMARK_CONTEXT.config.minAge &&
      DEFAULT_BENCHMARK_CONTEXT.user.country === 'US'
        ? 1
        : 0,
    iterations: 150_000,
  },
  {
    name: 'Risk scoring style expression',
    category: 'scoring',
    description:
      'A synthetic risk score based on age, country, and order total, using nested conditionals.',
    expression:
      '((user.country != "US" && !flags.allowHighRiskCountry) ? 50 : 0) + (order.total > 200 ? 30 : 10) + (user.age < 21 ? 20 : 0)',
    iterations: 120_000,
  },
  {
    name: 'Simple array combination',
    category: 'array',
    description:
      'Compute a weighted sum over the first 3 items in an order, using manual indexing.',
    expression:
      'order.items[0] * 1 + order.items[1] * 2 + order.items[2] * 3',
    iterations: 120_000,
  },
  {
    name: 'Feature flag driven discount',
    category: 'mixed',
    description:
      'Combine feature flags and user status to determine dynamic discount factor.',
    expression:
      '(user.premium && flags.vipBoost ? 0.85 : 1) * (flags.betaDiscounts ? 0.95 : 1)',
    iterations: 120_000,
  },
  {
    name: 'Tiered shipping logic',
    category: 'conditional',
    description:
      'Calculate effective shipping cost based on order total thresholds.',
    expression:
      'order.total >= 200 ? 0 : (order.total >= 100 ? shipping * 0.5 : shipping)',
    iterations: 150_000,
  },
  {
    name: 'Signup recency-like calculation',
    category: 'arithmetic',
    description:
      'Calculate a synthetic recency score (difference between two timestamps).',
    expression:
      '(order.createdAt - user.signupTimestamp) / (1000 * 60 * 60 * 24)',
    iterations: 150_000,
  },
  {
    name: 'Complex logical gate',
    category: 'logic',
    description:
      'Complex nested boolean logic with multiple conditions and negation.',
    expression:
      '(user.age >= config.minAge && user.premium) || (order.total > config.highValueThreshold && !flags.allowHighRiskCountry)',
    iterations: 150_000,
  },
  {
    name: 'Mixed scoring formula with ternary',
    category: 'scoring',
    description:
      'Score combining age band, premium flag, and high-value order bonus.',
    expression:
      '(user.age >= 18 && user.age < 25 ? 15 : user.age < 40 ? 10 : 5) + (user.premium ? 20 : 0) + (order.total >= config.highValueThreshold ? 30 : 0)',
    iterations: 100_000,
  },
];

/**
 * Utility: merge case-specific context overrides into the default benchmark context.
 *
 * This is handy for benchmarks that want to use per-case custom context without
 * re-creating large objects manually each time.
 */
export function buildContextForCase(
  base: ExpressionBenchmarkContext,
  custom?: Partial<ExpressionBenchmarkContext>,
): ExpressionBenchmarkContext {
  if (!custom) return base;

  return {
    ...base,
    ...custom,
    user: {
      ...base.user,
      ...(custom.user ?? {}),
    },
    order: {
      ...base.order,
      ...(custom.order ?? {}),
    },
    flags: {
      ...base.flags,
      ...(custom.flags ?? {}),
    },
    config: {
      ...base.config,
      ...(custom.config ?? {}),
    },
  };
}

/**
 * Utility: quick verification of an expression case.
 *
 * `runner` is any function that:
 *  - accepts an expression string and a context,
 *  - returns the evaluated result.
 *
 * This makes it easy to reuse for both Safexpr and alternative evaluators.
 */
export function verifyExpressionCase<R = unknown>(
  exprCase: ExpressionCase<ExpressionBenchmarkContext, R>,
  runner: (expression: string, ctx: ExpressionBenchmarkContext) => R,
  baseContext: ExpressionBenchmarkContext = DEFAULT_BENCHMARK_CONTEXT,
): { ok: boolean; expected?: R; actual?: R } {
  const ctx = buildContextForCase(baseContext, exprCase.customContext);
  const actual = runner(exprCase.expression, ctx);

  if (typeof exprCase.expected === 'undefined') {
    // No expected value provided; we only return the actual result.
    return { ok: true, actual };
  }

  // Simple strict equality check; adjust if you need epsilon checks for floats.
  const ok = (actual as unknown) === (exprCase.expected as unknown);

  return {
    ok,
    expected: exprCase.expected,
    actual,
  };
}
