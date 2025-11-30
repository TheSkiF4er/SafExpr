/**
 * SafExpr – Core / public types
 *
 * This module collects and exposes the *public* and *semi-public* type
 * aliases used across SafExpr. It exists so that consumers of the library
 * can import everything they need from a single place, without having to
 * know the internal file layout.
 *
 * Nothing in this module has runtime behavior – it is purely types and
 * interfaces. That means:
 *
 *   - No code is emitted for this module at compile time.
 *   - Importing from here is “free” at runtime.
 *
 * Typical usage in applications:
 *
 *   import type {
 *     Engine,
 *     EngineOptions,
 *     CompiledExpression,
 *     UserFunction,
 *     ExpressionNode,
 *     Token,
 *     SafexprErrorCode,
 *   } from 'safexpr/core/types';
 *
 * License: Apache-2.0
 * Author:  TheSkiF4er
 */

/////////////////////////
// Re-exports from AST //
/////////////////////////

import type { ExpressionNode } from './ast';

/**
 * Re-export of the core AST node type.
 *
 * This is the root node returned from the parser / compile() APIs.
 * See `src/core/ast.ts` for the full node hierarchy.
 */
export type { ExpressionNode } from './ast';

/////////////////////////////
// Re-exports from tokens  //
/////////////////////////////

import type { Token, TokenType } from './tokens';

export type { Token, TokenType } from './tokens';

/////////////////////////////
// Re-exports from errors  //
/////////////////////////////

import type { SafexprErrorCode } from './errors';

export type { SafexprErrorCode } from './errors';

/////////////////////////////
// Re-exports from engine  //
/////////////////////////////

import type {
  Engine,
  EngineOptions,
  NormalizedEngineOptions,
  CompiledExpression,
  UserFunction,
  ParseOptions,
  EvalOptions,
  FunctionRegistry,
} from './engine';

export type {
  Engine,
  EngineOptions,
  NormalizedEngineOptions,
  CompiledExpression,
  UserFunction,
  ParseOptions,
  EvalOptions,
  FunctionRegistry,
} from './engine';

/////////////////////////////
// Core convenience types  //
/////////////////////////////

/**
 * Generic "any context" type for SafExpr evaluations.
 *
 * Most applications should define their own specific context types:
 *
 *   type RuleContext = {
 *     user: { id: string; age: number; premium: boolean };
 *     order: { subtotal: number; taxRate: number };
 *   };
 *
 * and then use:
 *
 *   CompiledExpression<RuleContext, boolean>
 *
 * But for helpers, tests, and low-level APIs, `AnyContext` is convenient.
 */
export type AnyContext = Record<string, unknown>;

/**
 * Generic “any result” type.
 *
 * By default, SafExpr treats the result of an expression as unknown at
 * the type level. You can always narrow it via generics:
 *
 *   CompiledExpression<Ctx, number>
 */
export type AnyResult = unknown;

/**
 * Alias for helper functions registered with `.withFunction(name, fn)`.
 *
 * This is equivalent to `UserFunction`, but reads a bit clearer in
 * application code:
 *
 *   const engine = createEngine()
 *     .withFunction('sum', ((items: number[]) => ...) as HelperFunction);
 */
export type HelperFunction = UserFunction;

/**
 * A high-level description of a diagnostic location in a source string.
 *
 * This is intentionally a superset of the positional information present
 * on `SafexprError` (see `src/core/errors.ts`), and is useful when you
 * need to attach your own diagnostics or annotations to expressions.
 */
export interface DiagnosticLocation {
  /**
   * 0-based character offset in the source string.
   */
  index: number;

  /**
   * Optional 1-based line number.
   *
   * Note: if you only know `index`, you can compute `line` and `column`
   * using `computeLineAndColumn` from `src/core/errors.ts`.
   */
  line?: number;

  /**
   * Optional 1-based column number.
   */
  column?: number;

  /**
   * Optional length of the offending span (in characters).
   */
  length?: number;
}

/**
 * Generic shape for reporting diagnostics about an expression.
 *
 * This is not used internally by SafExpr’s core, but is provided as a
 * convenience type for tools and integrations that want a standard way
 * to surface issues (linting, editor hints, validation, etc.).
 */
export interface Diagnostic {
  /**
   * High-level category / code.
   *
   * Reuses the SafExpr error code space, but tools are free to define
   * their own subcategories in the `message` or via prefixes.
   */
  code: SafexprErrorCode;

  /**
   * Human-readable message.
   */
  message: string;

  /**
   * Optional note / hint (e.g. "did you mean '==' instead of '='?").
   */
  note?: string;

  /**
   * Optional location in the textual expression.
   */
  location?: DiagnosticLocation;
}

/**
 * Convenience alias for the typical "compiled + source" pattern.
 *
 * Many applications wrap a compiled expression with metadata:
 *
 *   type Rule<Ctx, R> = NamedCompiled<Ctx, R> & {
 *     id: string;
 *     createdAt: string;
 *   };
 */
export interface NamedCompiled<Context = AnyContext, Result = AnyResult> {
  /**
   * Human-readable name (e.g. rule id, label).
   */
  name: string;

  /**
   * Source expression string.
   */
  source: string;

  /**
   * Compiled evaluator; usually created via `engine.compile(...)`.
   */
  compiled: CompiledExpression<Context, Result>;
}

/**
 * Utility type: extract the context type parameter from a CompiledExpression.
 */
export type ContextOf<C> = C extends CompiledExpression<infer CTX, any>
  ? CTX
  : never;

/**
 * Utility type: extract the result type parameter from a CompiledExpression.
 */
export type ResultOf<C> = C extends CompiledExpression<any, infer R>
  ? R
  : never;

/**
 * Deep partial equivalent for JSON-like data structures.
 *
 * Useful for "patch" contexts where you want to allow partial shapes:
 *
 *   function withPatchedContext<C>(ctx: C, patch: DeepPartial<C>): C { ... }
 */
export type DeepPartial<T> = T extends (...args: any[]) => any
  ? T
  : T extends Array<infer U>
    ? Array<DeepPartial<U>>
    : T extends object
      ? { [K in keyof T]?: DeepPartial<T[K]> }
      : T;

/**
 * Shape of the options that can be fed into higher-level “rule engines”
 * built on top of SafExpr, where each rule is just a compiled expression
 * over some context type.
 *
 * This is intentionally generic and not used by SafExpr core, but many
 * projects end up defining something similar – so we provide a canonical
 * version here.
 */
export interface RuleEngineOptions<Context = AnyContext, Result = boolean> {
  /**
   * Optional shared SafExpr engine instance.
   * If omitted, a new engine (with default options) can be created instead.
   */
  engine?: Engine;

  /**
   * Optional helper that pre-processes raw rule source *before* compile,
   * e.g. macro expansion, variable aliasing, or versioned migration.
   */
  preprocessSource?(source: string): string;

  /**
   * Optional hook invoked after a rule is compiled.
   *
   * Can be used for logging, caching, or validating compiled ASTs.
   */
  onCompiled?(
    compiled: CompiledExpression<Context, Result>,
  ): void | Promise<void>;
}

/**
 * Minimal shape describing a rule loaded from some external store (e.g. DB).
 *
 * Not used internally by SafExpr, but suites the common pattern:
 *
 *   1. Load raw rule records.
 *   2. Compile them into SafExpr expressions.
 *   3. Evaluate them against contexts.
 */
export interface RawRule {
  id: string;
  source: string;
  description?: string;
  // Additional metadata fields (tenantId, tags, updatedAt, etc.) can be
  // added by applications as needed via declaration merging or extension.
}

::contentReference[oaicite:0]{index=0}
