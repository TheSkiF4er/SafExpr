/**
 * SafExpr – Engine core
 *
 * This module implements the public `createEngine` API and the internal
 * `Engine` implementation used to compile expressions into reusable
 * evaluators.
 *
 * Responsibilities of the engine:
 *  - Keep a registry of *trusted helper functions*.
 *  - Bridge between raw source strings and the parser / evaluator.
 *  - Apply (or forward) safety / DoS limits.
 *
 * It deliberately does *not* implement parsing or evaluation itself – those
 * live in dedicated modules (`parser`, `evaluator`).
 *
 * License: Apache-2.0
 * Author:  TheSkiF4er
 */

import type { ExpressionNode } from './ast';
// These modules are expected to be implemented in the core:
//  - parser:   turns source into an AST and enforces syntax & some safety.
//  - evaluator:evaluates an AST against a context and function registry.
import { parseExpression } from './parser';
import { evaluateExpression } from './evaluator';

//////////////////////
// Public interfaces //
//////////////////////

/**
 * Trusted user function exposed to expressions via `.withFunction(name, fn)`.
 *
 * Arguments are *untrusted data* from the expression / context.
 * The function body is *trusted application code*.
 */
export type UserFunction = (...args: any[]) => any;

/**
 * Engine-level options (DoS / safety configuration).
 *
 * All options are optional – sensible defaults are applied if omitted.
 *
 * Most of these are *forwarded* to the parser / evaluator, which are
 * responsible for actually enforcing the limits and throwing `SafexprError`
 * (or equivalent) on violation.
 */
export interface EngineOptions {
  /**
   * Maximum allowed length of an expression source string (in characters).
   * Very long expressions might be rejected by the parser.
   */
  maxExpressionLength?: number;

  /**
   * Maximum allowed AST depth (nesting of parentheses, ternaries, etc.).
   * Deeply nested expressions may be rejected by the parser.
   */
  maxAstDepth?: number;

  /**
   * Maximum allowed number of evaluation “steps”.
   * Interpretation is evaluator-specific but should upper-bound overall work.
   */
  maxEvalOperations?: number;

  /**
   * Keys that are considered "dangerous" for property access, typically:
   *   - "__proto__"
   *   - "constructor"
   *   - "prototype"
   *
   * If omitted, a safe default set is used.
   */
  dangerousKeys?: string[];

  /**
   * If true (default), access to `dangerousKeys` is rejected at compile or
   * evaluation time. If false, the evaluator may allow them (not recommended).
   */
  disallowDangerousKeys?: boolean;

  /**
   * If true, the parser/evaluator *may* allow references to global objects
   * like `globalThis`, `process`, `window`, etc.
   *
   * Default is `false` – engines are sandboxed and global access is forbidden.
   */
  allowUnsafeGlobalAccess?: boolean;
}

/**
 * A compiled expression produced by `engine.compile()` or top-level `compile()`.
 *
 *  - `eval(context)` evaluates the expression against a specific context.
 *  - `source` is the original string.
 *  - `ast` is the parsed AST, useful for tooling / debugging.
 */
export interface CompiledExpression<Context, Result = unknown> {
  /**
   * The original expression string.
   */
  readonly source: string;

  /**
   * Parsed AST representation of the expression.
   * The structure is described in `src/core/ast.ts`.
   */
  readonly ast: ExpressionNode;

  /**
   * Evaluate the expression against the given context object.
   *
   * May throw:
   *  - SafexprError (syntax / runtime / limit violations),
   *  - your own errors thrown from user functions registered via `withFunction`.
   */
  eval(context: Context): Result;
}

/**
 * Normalized engine options with defaults applied.
 * This is mostly an internal detail but exported for advanced integrations.
 */
export interface NormalizedEngineOptions {
  maxExpressionLength?: number;
  maxAstDepth?: number;
  maxEvalOperations?: number;
  dangerousKeys: string[];
  disallowDangerousKeys: boolean;
  allowUnsafeGlobalAccess: boolean;
}

/**
 * Public Engine interface returned by `createEngine`.
 *
 * Engines are intentionally small:
 *  - `withFunction` to register helpers.
 *  - `compile` to produce compiled expressions.
 *
 * Internally, engines are *immutable* – `withFunction` returns a new Engine
 * instance with the additional function, leaving the original unchanged.
 */
export interface Engine {
  /**
   * Engine configuration (read-only) with defaults applied.
   *
   * Useful for introspection and debugging.
   */
  readonly options: NormalizedEngineOptions;

  /**
   * Register a trusted helper function.
   *
   * Returns a *new* Engine instance with the function added.
   * The original engine remains unchanged.
   *
   * If a function with the same name already exists, it is replaced.
   */
  withFunction(name: string, fn: UserFunction): Engine;

  /**
   * Compile an expression string into a reusable `CompiledExpression`.
   *
   * The compiled object:
   *  - captures the engine’s current function registry and options;
   *  - can be reused many times with different contexts via `eval(context)`.
   */
  compile<Context, Result = unknown>(
    source: string,
  ): CompiledExpression<Context, Result>;
}

//////////////////////////////
// Default options & helpers //
//////////////////////////////

const DEFAULT_DANGEROUS_KEYS: readonly string[] = [
  '__proto__',
  'constructor',
  'prototype',
];

const DEFAULT_OPTIONS: NormalizedEngineOptions = {
  maxExpressionLength: undefined,
  maxAstDepth: undefined,
  maxEvalOperations: undefined,
  dangerousKeys: [...DEFAULT_DANGEROUS_KEYS],
  disallowDangerousKeys: true,
  allowUnsafeGlobalAccess: false,
};

/**
 * Merge user options with defaults.
 */
function normalizeOptions(opts?: EngineOptions): NormalizedEngineOptions {
  if (!opts) {
    // Clone to avoid accidental mutation of defaults.
    return {
      ...DEFAULT_OPTIONS,
      dangerousKeys: [...DEFAULT_OPTIONS.dangerousKeys],
    };
  }

  return {
    maxExpressionLength:
      typeof opts.maxExpressionLength === 'number'
        ? opts.maxExpressionLength
        : DEFAULT_OPTIONS.maxExpressionLength,
    maxAstDepth:
      typeof opts.maxAstDepth === 'number'
        ? opts.maxAstDepth
        : DEFAULT_OPTIONS.maxAstDepth,
    maxEvalOperations:
      typeof opts.maxEvalOperations === 'number'
        ? opts.maxEvalOperations
        : DEFAULT_OPTIONS.maxEvalOperations,
    dangerousKeys: Array.isArray(opts.dangerousKeys)
      ? [...opts.dangerousKeys]
      : [...DEFAULT_OPTIONS.dangerousKeys],
    disallowDangerousKeys:
      typeof opts.disallowDangerousKeys === 'boolean'
        ? opts.disallowDangerousKeys
        : DEFAULT_OPTIONS.disallowDangerousKeys,
    allowUnsafeGlobalAccess:
      typeof opts.allowUnsafeGlobalAccess === 'boolean'
        ? opts.allowUnsafeGlobalAccess
        : DEFAULT_OPTIONS.allowUnsafeGlobalAccess,
  };
}

/**
 * Internal shape of the function registry.
 *
 * We keep it as a plain object for simplicity & JSON-compatibility.
 */
export interface FunctionRegistry {
  [name: string]: UserFunction | undefined;
}

/**
 * Create a shallow copy of a function registry.
 */
function cloneRegistry(registry: FunctionRegistry): FunctionRegistry {
  const next: FunctionRegistry = Object.create(null);
  for (const key of Object.keys(registry)) {
    next[key] = registry[key];
  }
  return next;
}

///////////////////////////////
// Engine implementation core //
///////////////////////////////

/**
 * Internal Engine implementation.
 *
 *  - Immutable: `withFunction` returns a new EngineImpl.
 *  - Stateless: all state is captured in fields and in the compiled closures.
 */
class EngineImpl implements Engine {
  public readonly options: NormalizedEngineOptions;
  private readonly registry: FunctionRegistry;

  constructor(options: NormalizedEngineOptions, registry?: FunctionRegistry) {
    this.options = options;
    this.registry = registry ? registry : Object.create(null);
  }

  withFunction(name: string, fn: UserFunction): Engine {
    if (typeof name !== 'string' || name.trim() === '') {
      throw new Error('SafExpr: function name must be a non-empty string.');
    }
    if (typeof fn !== 'function') {
      throw new Error(
        `SafExpr: helper "${name}" must be a function, got ${typeof fn}.`,
      );
    }

    const nextRegistry = cloneRegistry(this.registry);
    nextRegistry[name] = fn;

    return new EngineImpl(this.options, nextRegistry);
  }

  compile<Context, Result = unknown>(
    source: string,
  ): CompiledExpression<Context, Result> {
    if (typeof source !== 'string') {
      throw new Error('SafExpr: expression source must be a string.');
    }

    // The parser is responsible for:
    //  - syntax validation,
    //  - AST depth checks,
    //  - detection of dangerous keys & globals,
    //  - reporting nice SafexprError diagnostics.
    const ast = parseExpression(source, {
      maxExpressionLength: this.options.maxExpressionLength,
      maxAstDepth: this.options.maxAstDepth,
      dangerousKeys: this.options.dangerousKeys,
      disallowDangerousKeys: this.options.disallowDangerousKeys,
      allowUnsafeGlobalAccess: this.options.allowUnsafeGlobalAccess,
    });

    const registrySnapshot = cloneRegistry(this.registry);
    const optionsSnapshot = { ...this.options };

    const compiled: CompiledExpression<Context, Result> = {
      source,
      ast,
      eval(context: Context): Result {
        // The evaluator is responsible for:
        //  - respecting `maxEvalOperations`,
        //  - implementing short-circuit logic for && / || / ??,
        //  - enforcing property access rules for dangerous keys & globals,
        //  - calling helpers from `registrySnapshot`,
        //  - throwing SafexprError or bubbling up user function errors.
        return evaluateExpression<Context, Result>(ast, context, {
          maxEvalOperations: optionsSnapshot.maxEvalOperations,
          functions: registrySnapshot,
          dangerousKeys: optionsSnapshot.dangerousKeys,
          disallowDangerousKeys: optionsSnapshot.disallowDangerousKeys,
          allowUnsafeGlobalAccess: optionsSnapshot.allowUnsafeGlobalAccess,
        });
      },
    };

    return compiled;
  }
}

//////////////////////
// Parser/evaluator //
// option contracts //
//////////////////////

/**
 * Options passed to `parseExpression`.
 *
 * This interface is intentionally exported so the parser implementation can
 * reuse it and stay structurally compatible with the engine.
 */
export interface ParseOptions {
  maxExpressionLength?: number;
  maxAstDepth?: number;
  dangerousKeys: string[];
  disallowDangerousKeys: boolean;
  allowUnsafeGlobalAccess: boolean;
}

/**
 * Options passed to `evaluateExpression`.
 *
 * This interface is intentionally exported so the evaluator implementation can
 * reuse it and stay structurally compatible with the engine.
 */
export interface EvalOptions {
  maxEvalOperations?: number;
  functions: FunctionRegistry;
  dangerousKeys: string[];
  disallowDangerousKeys: boolean;
  allowUnsafeGlobalAccess: boolean;
}

// Re-export types for parser/evaluator implementors’ convenience.
export type { ExpressionNode } from './ast';

////////////////////////
// Public entry point //
////////////////////////

/**
 * Create a new SafExpr Engine.
 *
 * Example:
 *
 * ```ts
 * import { createEngine } from 'safexpr';
 *
 * const engine = createEngine()
 *   .withFunction('max', (a: number, b: number) => Math.max(a, b))
 *   .withFunction('segment', (age: number) =>
 *     age < 18 ? 'child' : age < 30 ? 'young-adult' : 'adult',
 *   );
 *
 * const expr = engine.compile<{ user: { age: number } }, string>(
 *   'segment(user.age)',
 * );
 *
 * expr.eval({ user: { age: 24 } }); // "young-adult"
 * ```
 */
export function createEngine(options?: EngineOptions): Engine {
  const normalized = normalizeOptions(options);
  return new EngineImpl(normalized);
}
