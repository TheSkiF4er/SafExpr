/**
 * SafExpr – Collections plugin
 *
 * A small, opinionated set of helper functions for working with arrays
 * inside SafExpr expressions.
 *
 * The plugin registers a group of functions on an Engine:
 *
 *   - sum(items)        → number
 *   - avg(items)        → number
 *   - min(items)        → number | null
 *   - max(items)        → number | null
 *   - count(items)      → number
 *   - distinct(items)   → any[]
 *   - includes(items, value) → boolean
 *
 * All helpers are defensive:
 *   - `items` must be an array; otherwise they throw a runtime error.
 *   - numeric helpers validate that items can be interpreted as finite numbers.
 *
 * Example:
 *
 *   import { createEngine } from '../core/engine';
 *   import { collectionsPlugin } from '../plugins/collections';
 *
 *   type Ctx = { nums: number[]; tags: string[] };
 *
 *   const engine = collectionsPlugin(createEngine());
 *
 *   const expr1 = engine.compile<Ctx, number>('sum(nums) / count(nums)');
 *   const expr2 = engine.compile<Ctx, boolean>('includes(tags, "vip")');
 *
 *   expr1.eval({ nums: [1, 2, 3], tags: [] });       // 2
 *   expr2.eval({ nums: [], tags: ['vip', 'beta'] }); // true
 *
 * License: Apache-2.0
 * Author:  TheSkiF4er
 */

import type { Engine, UserFunction } from '../core/engine';

/////////////////////////////
// Plugin configuration    //
/////////////////////////////

/**
 * Options for the collections plugin.
 */
export interface CollectionsPluginOptions {
  /**
   * Optional prefix added in front of each helper name.
   *
   * For example, with prefix "coll_":
   *   - "sum"      → "coll_sum"
   *   - "avg"      → "coll_avg"
   *   - "min"      → "coll_min"
   *   - ...
   *
   * This is useful to avoid collisions with your own helper names.
   *
   * Default: '' (no prefix).
   */
  prefix?: string;

  /**
   * How to treat `null` / `undefined` items in numeric helpers.
   *
   *  - 'skip' (default): ignore nullish items when aggregating.
   *  - 'zero': treat nullish as 0.
   *  - 'strict': throw if any item is nullish.
   */
  nullishPolicy?: 'skip' | 'zero' | 'strict';
}

/**
 * Plugin entry point.
 *
 * Usage:
 *
 *   const engine = collectionsPlugin(createEngine(), { prefix: 'coll_' });
 */
export function collectionsPlugin(
  engine: Engine,
  options: CollectionsPluginOptions = {},
): Engine {
  const { prefix = '', nullishPolicy = 'skip' } = options;

  const name = (base: string): string => (prefix ? `${prefix}${base}` : base);

  let result = engine;

  // Numeric helpers
  result = result
    .withFunction(name('sum'), createSumFn(nullishPolicy))
    .withFunction(name('avg'), createAvgFn(nullishPolicy))
    .withFunction(name('min'), createMinFn(nullishPolicy))
    .withFunction(name('max'), createMaxFn(nullishPolicy));

  // Non-numeric helpers
  result = result
    .withFunction(name('count'), countFn)
    .withFunction(name('distinct'), distinctFn)
    .withFunction(name('includes'), includesFn);

  return result;
}

/**
 * Default export for convenience:
 *
 *   import collectionsPlugin from 'safexpr/plugins/collections';
 */
export default collectionsPlugin;

/////////////////////////////
// Helper implementations  //
/////////////////////////////

type NullishPolicy = NonNullable<CollectionsPluginOptions['nullishPolicy']>;

function assertArray(value: unknown, fnName: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(
      `SafExpr collections: ${fnName}() expects an array as its first argument.`,
    );
  }
  return value;
}

function toFiniteNumber(
  value: unknown,
  fnName: string,
  policy: NullishPolicy,
): number | null {
  if (value === null || value === undefined) {
    if (policy === 'skip') return null;
    if (policy === 'zero') return 0;
    throw new Error(
      `SafExpr collections: ${fnName}() encountered null/undefined item.`,
    );
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(
        `SafExpr collections: ${fnName}() encountered a non-finite number.`,
      );
    }
    return value;
  }

  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }

  throw new Error(
    `SafExpr collections: ${fnName}() expected numeric-like items, got ${typeof value}.`,
  );
}

/////////////////////////////
// Numeric aggregations    //
/////////////////////////////

function createSumFn(policy: NullishPolicy): UserFunction {
  return function sum(items: unknown): number {
    const arr = assertArray(items, 'sum');
    let acc = 0;

    for (const item of arr) {
      const n = toFiniteNumber(item, 'sum', policy);
      if (n === null) continue; // skip nullish items when policy === 'skip'
      acc += n;
    }

    return acc;
  };
}

function createAvgFn(policy: NullishPolicy): UserFunction {
  return function avg(items: unknown): number {
    const arr = assertArray(items, 'avg');
    let acc = 0;
    let count = 0;

    for (const item of arr) {
      const n = toFiniteNumber(item, 'avg', policy);
      if (n === null) continue;
      acc += n;
      count++;
    }

    if (count === 0) return 0;
    return acc / count;
  };
}

function createMinFn(policy: NullishPolicy): UserFunction {
  return function min(items: unknown): number | null {
    const arr = assertArray(items, 'min');
    let best: number | null = null;

    for (const item of arr) {
      const n = toFiniteNumber(item, 'min', policy);
      if (n === null) continue;
      if (best === null || n < best) {
        best = n;
      }
    }

    return best;
  };
}

function createMaxFn(policy: NullishPolicy): UserFunction {
  return function max(items: unknown): number | null {
    const arr = assertArray(items, 'max');
    let best: number | null = null;

    for (const item of arr) {
      const n = toFiniteNumber(item, 'max', policy);
      if (n === null) continue;
      if (best === null || n > best) {
        best = n;
      }
    }

    return best;
  };
}

/////////////////////////////
// Non-numeric helpers     //
/////////////////////////////

/**
 * count(items): returns the length of an array.
 */
const countFn: UserFunction = function count(items: unknown): number {
  const arr = assertArray(items, 'count');
  return arr.length;
};

/**
 * distinct(items): returns a new array with duplicate values removed.
 *
 * Uses `SameValueZero`-like semantics via `Set`, which is usually sufficient
 * for typical SafExpr use cases (primitives, small objects).
 */
const distinctFn: UserFunction = function distinct(items: unknown): unknown[] {
  const arr = assertArray(items, 'distinct');
  return Array.from(new Set(arr));
};

/**
 * includes(items, value): boolean
 *
 * Uses the same semantics as `Array.prototype.includes` (SameValueZero).
 */
const includesFn: UserFunction = function includes(
  items: unknown,
  value: unknown,
): boolean {
  const arr = assertArray(items, 'includes');
  return arr.includes(value as never);
};
