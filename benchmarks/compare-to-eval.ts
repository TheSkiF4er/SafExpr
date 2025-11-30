/**
 * Safexpr/benchmarks/compare-to-eval.ts
 *
 * Simple micro-benchmark that compares Safexpr against native `eval` (or `Function`)
 * for a set of representative expressions.
 *
 * IMPORTANT:
 * - This file is for local development only.
 * - The `eval` usage here is intentional and controlled, specifically for performance comparison.
 * - Do NOT copy this pattern into production code.
 *
 * How to run (examples):
 *   npx ts-node benchmarks/compare-to-eval.ts
 *   # or if you use tsx:
 *   npx tsx benchmarks/compare-to-eval.ts
 */

import { compile, createEngine } from '../src'; // adjust if your entry is elsewhere

type Context = {
  price: number;
  qty: number;
  user: { age: number; country: string; premium: boolean };
  order: { total: number; items: number[] };
};

type BenchmarkCase = {
  name: string;
  expression: string;
  iterations: number;
};

// Sample expressions that are somewhat realistic for Safexpr use cases
const CASES: BenchmarkCase[] = [
  {
    name: 'Simple arithmetic',
    expression: 'price * qty',
    iterations: 200_000,
  },
  {
    name: 'Conditional & property access',
    expression: 'user.premium ? order.total * 0.9 : order.total',
    iterations: 150_000,
  },
  {
    name: 'Logical & comparison',
    expression:
      'user.age >= 18 && user.country == "US" && order.total > 100 ? 1 : 0',
    iterations: 150_000,
  },
  {
    name: 'Array aggregation style',
    expression: 'order.items[0] + order.items[1] * 2 + order.items[2] * 3',
    iterations: 120_000,
  },
];

// Sample context
const ctx: Context = {
  price: 19.99,
  qty: 3,
  user: {
    age: 27,
    country: 'US',
    premium: true,
  },
  order: {
    total: 199.5,
    items: [1, 2, 3],
  },
};

// A tiny helper to avoid "unused" in benchmark loops
let sink = 0;

// Time measurement helpers
function nowMs(): number {
  if (typeof performance !== 'undefined' && performance.now) {
    return performance.now();
  }
  const [sec, nanosec] = process.hrtime();
  return sec * 1000 + nanosec / 1_000_000;
}

function formatNumber(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

type ResultRow = {
  name: string;
  iterations: number;
  safexprMs: number;
  evalMs: number;
};

async function runBenchmark(): Promise<void> {
  console.log('=== Safexpr vs eval benchmark ===');
  console.log();
  console.log('Context:', JSON.stringify(ctx, null, 2));
  console.log();

  const engine = createEngine();
  const results: ResultRow[] = [];

  for (const testCase of CASES) {
    const { name, expression, iterations } = testCase;

    console.log(`--- Case: ${name} ---`);
    console.log(`Expression: ${expression}`);
    console.log(`Iterations: ${iterations}`);
    console.log();

    // Compile once for Safexpr
    const safexprCompiled = engine.compile<Context, unknown>(expression);

    // Warm-up Safexpr
    for (let i = 0; i < 5_000; i++) {
      sink ^= Number(safexprCompiled.eval(ctx) ?? 0);
    }

    const safexprStart = nowMs();
    for (let i = 0; i < iterations; i++) {
      sink ^= Number(safexprCompiled.eval(ctx) ?? 0);
    }
    const safexprEnd = nowMs();
    const safexprMs = safexprEnd - safexprStart;

    // Prepare a Function-based evaluator to simulate "eval"-style usage
    // NOTE: This is intentionally unsafe and only for benchmarking.
    const evalFn = new Function(
      'ctx',
      `
      const price = ctx.price;
      const qty = ctx.qty;
      const user = ctx.user;
      const order = ctx.order;
      return ${expression};
    `,
    ) as (context: Context) => unknown;

    // Warm-up eval/Function
    for (let i = 0; i < 5_000; i++) {
      sink ^= Number(evalFn(ctx) ?? 0);
    }

    const evalStart = nowMs();
    for (let i = 0; i < iterations; i++) {
      sink ^= Number(evalFn(ctx) ?? 0);
    }
    const evalEnd = nowMs();
    const evalMs = evalEnd - evalStart;

    results.push({ name, iterations, safexprMs, evalMs });

    console.log(`Safexpr: ${formatNumber(safexprMs)} ms`);
    console.log(`eval/Function: ${formatNumber(evalMs)} ms`);
    const ratio =
      safexprMs > 0 ? formatNumber(evalMs / safexprMs) : 'N/A';
    console.log(`Relative (eval / Safexpr): ~${ratio}x`);
    console.log();
  }

  // Prevent optimizer from removing calculations
  console.log('Ignore (sink):', sink);
  console.log();

  printSummary(results);
}

function printSummary(rows: ResultRow[]): void {
  console.log('=== Summary (lower is better) ===');
  console.log();

  const header = [
    pad('Case', 32),
    pad('Iterations', 12),
    pad('Safexpr ms', 14),
    pad('Eval/Function ms', 18),
    pad('Eval / Safexpr', 16),
  ].join(' | ');

  const sep = [
    '-'.repeat(32),
    '-'.repeat(12),
    '-'.repeat(14),
    '-'.repeat(18),
    '-'.repeat(16),
  ].join('-|-');

  console.log(header);
  console.log(sep);

  for (const row of rows) {
    const ratio =
      row.safexprMs > 0 ? row.evalMs / row.safexprMs : NaN;
    console.log(
      [
        pad(row.name, 32),
        pad(formatNumber(row.iterations), 12),
        pad(formatNumber(row.safexprMs), 14),
        pad(formatNumber(row.evalMs), 18),
        pad(
          Number.isFinite(ratio)
            ? `~${formatNumber(ratio)}x`
            : 'N/A',
          16,
        ),
      ].join(' | '),
    );
  }

  console.log();
  console.log(
    'Note: This benchmark is synthetic and only one data point.',
  );
  console.log(
    'Always profile with your own expressions and workload.',
  );
}

function pad(value: string, width: number): string {
  if (value.length >= width) return value.slice(0, width);
  return value + ' '.repeat(width - value.length);
}

runBenchmark().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exitCode = 1;
});
