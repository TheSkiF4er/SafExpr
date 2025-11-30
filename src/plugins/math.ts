/**
 * SafExpr – Math plugin
 *
 * A curated set of numeric & trigonometric helpers for SafExpr expressions.
 *
 * All helpers are pure functions built on top of JS Math, with defensive
 * argument validation and predictable error messages.
 *
 * Example:
 *
 *   import { createEngine } from '../core/engine';
 *   import { mathPlugin } from '../plugins/math';
 *
 *   type Ctx = { price: number; qty: number };
 *
 *   const engine = mathPlugin(createEngine(), { angleUnit: 'deg' });
 *
 *   const expr = engine.compile<Ctx, number>(
 *     'round(clamp(price * qty * cos(30), 0, 1000))',
 *   );
 *
 *   expr.eval({ price: 10, qty: 5 }); // → some number
 *
 * License: Apache-2.0
 * Author:  TheSkiF4er
 */

import type { Engine, UserFunction } from '../core/engine';

/////////////////////////////
// Plugin configuration    //
/////////////////////////////

/**
 * Angle unit for trigonometric helpers.
 *
 *  - 'rad' (default): interpret arguments as radians (native Math behavior).
 *  - 'deg': interpret arguments as degrees (converted to/from radians).
 */
export type AngleUnit = 'rad' | 'deg';

export interface MathPluginOptions {
  /**
   * Optional prefix added to every helper name.
   *
   * Example:
   *   prefix = "m_"
   *   → "abs" → "m_abs", "clamp" → "m_clamp", ...
   *
   * Default: '' (no prefix).
   */
  prefix?: string;

  /**
   * Angle unit used by trigonometric helpers.
   *
   * - 'rad' (default): sin(PI/2) → 1
   * - 'deg':  sin(90) → 1
   */
  angleUnit?: AngleUnit;

  /**
   * Optional flag to disallow operations that produce Infinity or NaN.
   *
   * If true:
   *   - sqrt of negative numbers
   *   - division by zero
   *   - overflow-producing pow, etc.
   *
   * will throw an Error instead of returning Infinity/NaN.
   *
   * Default: true.
   */
  strictFinite?: boolean;
}

/**
 * Math plugin entry point.
 *
 * Usage:
 *
 *   const engine = mathPlugin(createEngine(), {
 *     prefix: 'math_',
 *     angleUnit: 'deg',
 *   });
 */
export function mathPlugin(
  engine: Engine,
  options: MathPluginOptions = {},
): Engine {
  const {
    prefix = '',
    angleUnit = 'rad',
    strictFinite = true,
  } = options;

  const ctx: MathContext = {
    angleUnit,
    strictFinite,
  };

  const name = (base: string): string => (prefix ? `${prefix}${base}` : base);

  let result = engine;

  // Basic numeric transforms
  result = result
    .withFunction(name('abs'), makeUnaryNumeric('abs', Math.abs, ctx))
    .withFunction(name('ceil'), makeUnaryNumeric('ceil', Math.ceil, ctx))
    .withFunction(name('floor'), makeUnaryNumeric('floor', Math.floor, ctx))
    .withFunction(name('round'), makeUnaryNumeric('round', Math.round, ctx))
    .withFunction(name('sqrt'), makeSqrtFn(ctx))
    .withFunction(name('sign'), makeUnaryNumeric('sign', Math.sign, ctx));

  // Binary operations
  result = result
    .withFunction(name('pow'), makePowFn(ctx))
    .withFunction(name('clamp'), makeClampFn(ctx))
    .withFunction(name('min'), makeMinMaxFn('min', Math.min, ctx))
    .withFunction(name('max'), makeMinMaxFn('max', Math.max, ctx));

  // Random helpers (non-deterministic)
  result = result
    .withFunction(name('random'), makeRandomFn(ctx))
    .withFunction(name('randomInt'), makeRandomIntFn(ctx));

  // Trigonometry (respecting angleUnit)
  result = result
    .withFunction(name('sin'), makeTrigFn('sin', Math.sin, ctx))
    .withFunction(name('cos'), makeTrigFn('cos', Math.cos, ctx))
    .withFunction(name('tan'), makeTrigFn('tan', Math.tan, ctx))
    .withFunction(name('asin'), makeInverseTrigFn('asin', Math.asin, ctx))
    .withFunction(name('acos'), makeInverseTrigFn('acos', Math.acos, ctx))
    .withFunction(name('atan'), makeInverseTrigFn('atan', Math.atan, ctx))
    .withFunction(name('atan2'), makeAtan2Fn(ctx))
    .withFunction(name('deg'), makeDegFn())
    .withFunction(name('rad'), makeRadFn());

  return result;
}

/**
 * Default export for convenience:
 *
 *   import mathPlugin from 'safexpr/plugins/math';
 */
export default mathPlugin;

/////////////////////////////
// Internal context & utils //
/////////////////////////////

interface MathContext {
  angleUnit: AngleUnit;
  strictFinite: boolean;
}

function assertNumber(
  value: unknown,
  fnName: string,
  argIndex: number,
): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(
        `SafExpr math: ${fnName}() argument #${argIndex} must be a finite number.`,
      );
    }
    return value;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) {
      return n;
    }
  }

  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }

  if (value === null || value === undefined) {
    throw new Error(
      `SafExpr math: ${fnName}() argument #${argIndex} must be a number, got ${String(
        value,
      )}.`,
    );
  }

  throw new Error(
    `SafExpr math: ${fnName}() argument #${argIndex} must be a number, got ${typeof value}.`,
  );
}

function ensureFiniteResult(
  value: number,
  fnName: string,
): number {
  if (!Number.isFinite(value)) {
    throw new Error(
      `SafExpr math: ${fnName}() produced a non-finite result (${String(
        value,
      )}).`,
    );
  }
  return value;
}

function toRadians(value: number, ctx: MathContext): number {
  if (ctx.angleUnit === 'rad') return value;
  // deg → rad
  return (value * Math.PI) / 180;
}

function fromRadians(value: number, ctx: MathContext): number {
  if (ctx.angleUnit === 'rad') return value;
  // rad → deg
  return (value * 180) / Math.PI;
}

/////////////////////////////
// Core helper factories   //
/////////////////////////////

/**
 * Create a simple unary numeric function (e.g. abs, ceil, floor, round, sign).
 */
function makeUnaryNumeric(
  fnName: string,
  op: (x: number) => number,
  ctx: MathContext,
): UserFunction {
  return function unaryNumeric(x: unknown): number {
    const v = assertNumber(x, fnName, 1);
    const out = op(v);
    return ctx.strictFinite ? ensureFiniteResult(out, fnName) : out;
  };
}

/**
 * sqrt(x): non-negative only (in strictFinite mode).
 */
function makeSqrtFn(ctx: MathContext): UserFunction {
  return function sqrt(value: unknown): number {
    const v = assertNumber(value, 'sqrt', 1);

    if (ctx.strictFinite && v < 0) {
      throw new Error(
        'SafExpr math: sqrt() cannot be applied to a negative value in strict mode.',
      );
    }

    const out = Math.sqrt(v);
    return ctx.strictFinite ? ensureFiniteResult(out, 'sqrt') : out;
  };
}

/**
 * pow(base, exponent).
 */
function makePowFn(ctx: MathContext): UserFunction {
  return function pow(base: unknown, exponent: unknown): number {
    const b = assertNumber(base, 'pow', 1);
    const e = assertNumber(exponent, 'pow', 2);
    const out = Math.pow(b, e);
    return ctx.strictFinite ? ensureFiniteResult(out, 'pow') : out;
  };
}

/**
 * clamp(value, min, max).
 */
function makeClampFn(ctx: MathContext): UserFunction {
  return function clamp(
    value: unknown,
    min: unknown,
    max: unknown,
  ): number {
    const v = assertNumber(value, 'clamp', 1);
    const lo = assertNumber(min, 'clamp', 2);
    const hi = assertNumber(max, 'clamp', 3);

    if (lo > hi) {
      // We still define behavior: swap bounds.
      const tmp = lo;
      (min as number) = hi;
      (max as number) = tmp;
      return Math.min(Math.max(v, hi), lo);
    }

    const out = Math.min(Math.max(v, lo), hi);
    return ctx.strictFinite ? ensureFiniteResult(out, 'clamp') : out;
  };
}

/**
 * min(a, b, ...): accepts 1 or more args.
 */
function makeMinMaxFn(
  fnName: 'min' | 'max',
  op: (...values: number[]) => number,
  ctx: MathContext,
): UserFunction {
  return function minMax(...args: unknown[]): number {
    if (args.length === 0) {
      throw new Error(
        `SafExpr math: ${fnName}() expects at least one argument.`,
      );
    }

    const values = args.map((v, i) => assertNumber(v, fnName, i + 1));
    const out = op(...values);
    return ctx.strictFinite ? ensureFiniteResult(out, fnName) : out;
  };
}

/**
 * random(): number in [0, 1).
 */
function makeRandomFn(ctx: MathContext): UserFunction {
  return function random(): number {
    const out = Math.random();
    return ctx.strictFinite ? ensureFiniteResult(out, 'random') : out;
  };
}

/**
 * randomInt(min, max): integer in [min, max] (inclusive).
 */
function makeRandomIntFn(ctx: MathContext): UserFunction {
  return function randomInt(min: unknown, max: unknown): number {
    const lo = assertNumber(min, 'randomInt', 1);
    const hi = assertNumber(max, 'randomInt', 2);

    if (!Number.isInteger(lo) || !Number.isInteger(hi)) {
      throw new Error(
        'SafExpr math: randomInt() expects integer bounds.',
      );
    }

    if (lo > hi) {
      throw new Error(
        'SafExpr math: randomInt() requires min <= max.',
      );
    }

    const span = hi - lo + 1;
    const out = lo + Math.floor(Math.random() * span);
    return ctx.strictFinite ? ensureFiniteResult(out, 'randomInt') : out;
  };
}

/**
 * Trig helpers (sin, cos, tan) that accept angle in configured unit.
 */
function makeTrigFn(
  fnName: 'sin' | 'cos' | 'tan',
  op: (x: number) => number,
  ctx: MathContext,
): UserFunction {
  return function trig(angle: unknown): number {
    const v = assertNumber(angle, fnName, 1);
    const rad = toRadians(v, ctx);
    const out = op(rad);
    return ctx.strictFinite ? ensureFiniteResult(out, fnName) : out;
  };
}

/**
 * Inverse trig helpers (asin, acos, atan).
 * They return the result in the configured angle unit.
 */
function makeInverseTrigFn(
  fnName: 'asin' | 'acos' | 'atan',
  op: (x: number) => number,
  ctx: MathContext,
): UserFunction {
  return function inverseTrig(x: unknown): number {
    const v = assertNumber(x, fnName, 1);
    const rad = op(v);
    const out = fromRadians(rad, ctx);
    return ctx.strictFinite ? ensureFiniteResult(out, fnName) : out;
  };
}

/**
 * atan2(y, x): returns angle in configured unit.
 */
function makeAtan2Fn(ctx: MathContext): UserFunction {
  return function atan2(y: unknown, x: unknown): number {
    const yy = assertNumber(y, 'atan2', 1);
    const xx = assertNumber(x, 'atan2', 2);
    const rad = Math.atan2(yy, xx);
    const out = fromRadians(rad, ctx);
    return ctx.strictFinite ? ensureFiniteResult(out, 'atan2') : out;
  };
}

/**
 * deg(x): convert radians to degrees.
 *
 * This is independent of the plugin's `angleUnit`; it always converts
 * from radians to degrees.
 */
function makeDegFn(): UserFunction {
  return function deg(value: unknown): number {
    const v = assertNumber(value, 'deg', 1);
    const out = (v * 180) / Math.PI;
    if (!Number.isFinite(out)) {
      throw new Error('SafExpr math: deg() produced a non-finite result.');
    }
    return out;
  };
}

/**
 * rad(x): convert degrees to radians.
 *
 * This is independent of the plugin's `angleUnit`; it always converts
 * from degrees to radians.
 */
function makeRadFn(): UserFunction {
  return function rad(value: unknown): number {
    const v = assertNumber(value, 'rad', 1);
    const out = (v * Math.PI) / 180;
    if (!Number.isFinite(out)) {
      throw new Error('SafExpr math: rad() produced a non-finite result.');
    }
    return out;
  };
                  }
