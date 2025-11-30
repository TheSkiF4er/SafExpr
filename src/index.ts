/**
 * SafExpr – Public entry point
 *
 * This file defines the **public API surface** of SafExpr.
 *
 * It provides:
 *  - Core engine factory (`createEngine`) and convenience helpers
 *    (`compileExpression`, `evaluateExpression`).
 *  - Public types for AST, engine, errors, diagnostics, and plugins.
 *  - Built-in plugins (collections, datetime, math) and composition helpers.
 *  - Utilities for inspection, validation, and tooling support.
 *  - Optional integrations for Node (HTTP middleware) and React.
 *
 * Typical usage:
 *
 *   import {
 *     createEngine,
 *     collectionsPlugin,
 *     datetimePlugin,
 *     mathPlugin,
 *     compileExpression,
 *     evaluateExpression,
 *   } from 'safexpr';
 *
 *   type Ctx = { price: number; qty: number; tags: string[] };
 *
 *   const engine = mathPlugin(
 *     datetimePlugin(
 *       collectionsPlugin(createEngine()),
 *     ),
 *   );
 *
 *   const discountExpr = engine.compile<Ctx, number>(
 *     'clamp(price * qty * 0.1, 0, 100)',
 *   );
 *
 *   const result = discountExpr.eval({
 *     price: 19.99,
 *     qty: 3,
 *     tags: ['vip'],
 *   });
 *
 * License: Apache-2.0
 * Author:  TheSkiF4er
 */

/////////////////////////////
// Core engine & types     //
/////////////////////////////

import { createEngine } from './core/engine';

import type {
  Engine,
  EngineOptions,
  CompiledExpression,
  UserFunction,
  NormalizedEngineOptions,
  ParseOptions,
  EvalOptions,
  FunctionRegistry,
} from './core/engine';

import type {
  AnyContext,
  AnyResult,
  HelperFunction,
  Diagnostic,
  DiagnosticLocation,
  RuleEngineOptions,
  RawRule,
  NamedCompiled,
  ContextOf,
  ResultOf,
  DeepPartial,
} from './core/types';

import type {
  ExpressionNode,
  LiteralNode,
  IdentifierNode,
  UnaryExpressionNode,
  BinaryExpressionNode,
  LogicalExpressionNode,
  NullishCoalescingExpressionNode,
  ConditionalExpressionNode,
  MemberExpressionNode,
  CallExpressionNode,
  ArrayExpressionNode,
  ObjectExpressionNode,
  PropertyNode,
} from './core/ast';

import type { Token, TokenType } from './core/tokens';

import {
  SafexprError,
  isSafexprError,
} from './core/errors';
import type { SafexprErrorCode } from './core/errors';

/////////////////////////////
// Plugins                 //
/////////////////////////////

import {
  collectionsPlugin,
  datetimePlugin,
  applyPlugins,
  createPluginSet,
} from './plugins';

import type {
  CollectionsPluginOptions,
} from './plugins/collections';

import {
  datetimePlugin as _datetimePluginDirect,
} from './plugins/datetime';
import type {
  DatetimePluginOptions,
  TimeZoneMode,
} from './plugins/datetime';

import { mathPlugin } from './plugins/math';
import type {
  MathPluginOptions,
  AngleUnit,
} from './plugins/math';

/////////////////////////////
// Utilities               //
/////////////////////////////

import {
  inspectValue,
  formatSafexprError,
  inspectCompiledExpression,
  analyzeAst,
  inspectSourceExpression,
} from './utils/inspect';

import type {
  InspectValueOptions,
  FormattedSafexprError,
  ExpressionAstInsight,
  InspectSourceOptions,
} from './utils/inspect';

import {
  validateAst,
  validateSourceExpression,
} from './utils/validation';

import type {
  IssueSeverity,
  ExpressionValidationIssue,
  ExpressionValidationStats,
  ExpressionValidationResult,
  ValidateSourceExpressionOptions,
  SourceExpressionValidationResult,
} from './utils/validation';

/////////////////////////////
// Node integration        //
/////////////////////////////

import {
  createSafeEvalMiddleware,
} from './integrations/node/safeEvalMiddleware';

import type {
  SafeEvalRequestPayload,
  SafeEvalResponse,
  SafeEvalMiddlewareOptions,
  SafeEvalRequestExtension,
} from './integrations/node/safeEvalMiddleware';

/////////////////////////////
// React integration       //
/////////////////////////////

// React is **optional** – tree-shaking will drop these in non-React builds.
import ExpressionInputDefault, {
  ExpressionInput,
} from './integrations/react/ExpressionInput';

import type {
  ExpressionInputProps,
  ExpressionValidationResult as ExpressionInputValidationResult,
} from './integrations/react/ExpressionInput';

import useExpressionDefault, {
  useExpression,
} from './integrations/react/useExpression';

import type {
  UseExpressionOptions,
  UseExpressionResult,
  UseExpressionError,
} from './integrations/react/useExpression';

/////////////////////////////
// Convenience helpers     //
/////////////////////////////

/**
 * Compile a single expression with a given engine or engine options.
 *
 * If the second argument is:
 *  - an Engine → it is used as-is;
 *  - an EngineOptions object (or omitted) → a new engine is created via `createEngine`.
 */
export function compileExpression<
  Context = AnyContext,
  Result = AnyResult,
>(
  source: string,
  engineOrOptions?: Engine | EngineOptions,
): CompiledExpression<Context, Result> {
  let engine: Engine;

  if (
    engineOrOptions &&
    typeof (engineOrOptions as Engine).compile === 'function'
  ) {
    engine = engineOrOptions as Engine;
  } else {
    engine = createEngine(engineOrOptions as EngineOptions | undefined);
  }

  return engine.compile<Context, Result>(source);
}

/**
 * One-shot helper: compile + evaluate an expression with a context.
 *
 * This is ideal for quick checks, tests, or scripts:
 *
 *   const result = evaluateExpression<Ctx, number>(
 *     'price * qty',
 *     { price: 10, qty: 3 },
 *   );
 */
export function evaluateExpression<
  Context = AnyContext,
  Result = AnyResult,
>(
  source: string,
  context: Context,
  engineOrOptions?: Engine | EngineOptions,
): Result {
  const compiled = compileExpression<Context, Result>(source, engineOrOptions);
  return compiled.eval(context);
}

/////////////////////////////
// Public exports          //
/////////////////////////////

// Core factory & helpers
export { createEngine, compileExpression, evaluateExpression };

// Core types
export type {
  Engine,
  EngineOptions,
  NormalizedEngineOptions,
  CompiledExpression,
  UserFunction,
  HelperFunction,
  ParseOptions,
  EvalOptions,
  FunctionRegistry,
  AnyContext,
  AnyResult,
  Diagnostic,
  DiagnosticLocation,
  RuleEngineOptions,
  RawRule,
  NamedCompiled,
  ContextOf,
  ResultOf,
  DeepPartial,
};

// AST types
export type {
  ExpressionNode,
  LiteralNode,
  IdentifierNode,
  UnaryExpressionNode,
  BinaryExpressionNode,
  LogicalExpressionNode,
  NullishCoalescingExpressionNode,
  ConditionalExpressionNode,
  MemberExpressionNode,
  CallExpressionNode,
  ArrayExpressionNode,
  ObjectExpressionNode,
  PropertyNode,
};

// Tokens
export type { Token, TokenType };

// Errors
export { SafexprError, isSafexprError };
export type { SafexprErrorCode };

// Plugins
export {
  collectionsPlugin,
  datetimePlugin,
  _datetimePluginDirect as datetimePluginDirect, // alias for direct import if needed
  mathPlugin,
  applyPlugins,
  createPluginSet,
};
export type {
  CollectionsPluginOptions,
  DatetimePluginOptions,
  TimeZoneMode,
  MathPluginOptions,
  AngleUnit,
};

// Utilities: inspection
export {
  inspectValue,
  formatSafexprError,
  inspectCompiledExpression,
  analyzeAst,
  inspectSourceExpression,
};
export type {
  InspectValueOptions,
  FormattedSafexprError,
  ExpressionAstInsight,
  InspectSourceOptions,
};

// Utilities: validation
export {
  validateAst,
  validateSourceExpression,
};
export type {
  IssueSeverity,
  ExpressionValidationIssue,
  ExpressionValidationStats,
  ExpressionValidationResult,
  ValidateSourceExpressionOptions,
  SourceExpressionValidationResult,
};

// Node integration
export {
  createSafeEvalMiddleware,
};
export type {
  SafeEvalRequestPayload,
  SafeEvalResponse,
  SafeEvalMiddlewareOptions,
  SafeEvalRequestExtension,
};

// React integration
export {
  ExpressionInput,
  ExpressionInputDefault,
  useExpression,
  useExpressionDefault,
};
export type {
  ExpressionInputProps,
  ExpressionInputValidationResult,
  UseExpressionOptions,
  UseExpressionResult,
  UseExpressionError,
};
