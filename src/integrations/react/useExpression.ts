/**
 * SafExpr – React integration / useExpression
 *
 * A reusable React hook that helps you:
 *  - Manage an expression string in state.
 *  - Compile it with SafExpr (optionally debounced).
 *  - Surface validation errors (with SafexprError details).
 *  - Evaluate the compiled expression against a context.
 *
 * Typical usage:
 *
 *   import React from 'react';
 *   import { useExpression } from 'safexpr/src/integrations/react/useExpression';
 *
 *   type Ctx = { price: number; qty: number };
 *
 *   export function DiscountRule() {
 *     const {
 *       expression,
 *       setExpression,
 *       compiled,
 *       error,
 *       isValid,
 *       evaluate,
 *       lastResult,
 *     } = useExpression<Ctx, number>({
 *       initialExpression: 'price * qty',
 *       defaultContext: { price: 10, qty: 2 },
 *     });
 *
 *     return (
 *       <div>
 *         <textarea
 *           value={expression}
 *           onChange={(e) => setExpression(e.target.value)}
 *         />
 *
 *         <button
 *           type="button"
 *           onClick={() =>
 *             evaluate({ price: 19.99, qty: 3 })
 *           }
 *           disabled={!isValid}
 *         >
 *           Evaluate
 *         </button>
 *
 *         {isValid && lastResult != null && (
 *           <pre>Result: {JSON.stringify(lastResult)}</pre>
 *         )}
 *
 *         {error && (
 *           <pre style={{ color: 'red' }}>
 *             {error.code}: {error.message}
 *           </pre>
 *         )}
 *       </div>
 *     );
 *   }
 *
 * License: Apache-2.0
 * Author:  TheSkiF4er
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { createEngine } from '../../core/engine';
import type {
  Engine,
  CompiledExpression,
} from '../../core/engine';
import {
  SafexprError,
  isSafexprError,
} from '../../core/errors';

//////////////////////
// Types & helpers  //
//////////////////////

/**
 * Validation / compilation result used by the hook.
 */
export interface UseExpressionError {
  code: string;
  message: string;
  line?: number | null;
  column?: number | null;
  snippet?: string;
  note?: string;
}

/**
 * Options for the `useExpression` hook.
 *
 * Generics:
 *  - Context – type of the evaluation context.
 *  - Result  – type of the expression result.
 */
export interface UseExpressionOptions<
  Context = Record<string, unknown>,
  Result = unknown,
> {
  /**
   * Initial expression string.
   * Default: ''.
   */
  initialExpression?: string;

  /**
   * Custom SafExpr Engine instance.
   * If omitted, the hook uses a shared default engine.
   */
  engine?: Engine;

  /**
   * If true (default), the hook will automatically compile the expression
   * whenever it changes (with debounce).
   */
  autoCompile?: boolean;

  /**
   * Debounce delay in milliseconds for auto-compilation.
   * Default: 200 ms.
   */
  debounceMs?: number;

  /**
   * If true, the hook will try to compile the initial expression immediately
   * on mount (subject to `autoCompile`).
   * Default: true.
   */
  validateOnMount?: boolean;

  /**
   * Optional default context used by `evaluate()` when no explicit context
   * is provided.
   */
  defaultContext?: Context;

  /**
   * Optional callback invoked whenever the expression is successfully compiled.
   */
  onCompiled?(compiled: CompiledExpression<Context, Result>): void;

  /**
   * Optional callback invoked whenever a SafExpr-related error occurs during
   * compilation or evaluation.
   */
  onError?(error: UseExpressionError, rawError: unknown): void;
}

/**
 * Result of the `useExpression` hook.
 */
export interface UseExpressionResult<
  Context = Record<string, unknown>,
  Result = unknown,
> {
  /**
   * Current expression string.
   */
  expression: string;

  /**
   * Update the current expression string.
   */
  setExpression(next: string): void;

  /**
   * Compiled expression (if compilation succeeded).
   */
  compiled: CompiledExpression<Context, Result> | null;

  /**
   * Whether the current expression is considered valid (compiled successfully).
   */
  isValid: boolean;

  /**
   * Whether there is a validation / compilation error.
   */
  hasError: boolean;

  /**
   * Last error emitted during compilation or evaluation (if any).
   */
  error: UseExpressionError | null;

  /**
   * Whether the hook is currently compiling (debounced compilation pending).
   */
  isCompiling: boolean;

  /**
   * Last evaluation result (if any).
   *
   * Note: `undefined` may be a legitimate result value; use `hasResult`
   * if you need to distinguish “no evaluation yet” from “evaluated to undefined”.
   */
  lastResult: Result | undefined;

  /**
   * Whether `lastResult` corresponds to a completed evaluation.
   */
  hasResult: boolean;

  /**
   * Force a recompile of the current expression immediately (bypassing debounce).
   *
   * Returns the compiled expression (or null if compilation fails).
   */
  recompile(): CompiledExpression<Context, Result> | null;

  /**
   * Evaluate the expression against a context (or `defaultContext` if omitted).
   *
   * This will throw if there is no compiled expression available and
   * `autoCompile` is disabled or compilation failed.
   */
  evaluate(context?: Context): Result;

  /**
   * Clear the current error state.
   */
  clearError(): void;
}

/**
 * Shared default engine instance (used when no custom engine is passed).
 */
const defaultEngine: Engine = createEngine();

//////////////////////
// Hook implementation
//////////////////////

export function useExpression<
  Context = Record<string, unknown>,
  Result = unknown,
>(
  options: UseExpressionOptions<Context, Result> = {},
): UseExpressionResult<Context, Result> {
  const {
    initialExpression = '',
    engine = defaultEngine,
    autoCompile = true,
    debounceMs = 200,
    validateOnMount = true,
    defaultContext,
    onCompiled,
    onError,
  } = options;

  const [expression, setExpression] = useState<string>(initialExpression);
  const [compiled, setCompiled] =
    useState<CompiledExpression<Context, Result> | null>(null);
  const [error, setError] = useState<UseExpressionError | null>(null);
  const [isCompiling, setIsCompiling] = useState<boolean>(false);
  const [hasResult, setHasResult] = useState<boolean>(false);
  const [lastResult, setLastResult] = useState<Result | undefined>(undefined);

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- Internal helpers -----------------------------------------------------

  const mapError = useCallback(
    (err: unknown): UseExpressionError => {
      if (isSafexprError(err)) {
        const se = err as SafexprError;
        return {
          code: se.code,
          message: se.message,
          line: se.line ?? undefined,
          column: se.column ?? undefined,
          snippet: se.snippet || undefined,
          note: se.note || undefined,
        };
      }

      const msg =
        err instanceof Error && typeof err.message === 'string'
          ? err.message
          : String(err);

      return {
        code: 'E_RUNTIME',
        message: msg,
      };
    },
    [],
  );

  const runCompile = useCallback(
    (source: string): CompiledExpression<Context, Result> | null => {
      try {
        setIsCompiling(false);
        const result = engine.compile<Context, Result>(source);
        setCompiled(result);
        setError(null);
        if (onCompiled) {
          onCompiled(result);
        }
        return result;
      } catch (err) {
        const mapped = mapError(err);
        setCompiled(null);
        setError(mapped);
        if (onError) {
          onError(mapped, err);
        }
        return null;
      }
    },
    [engine, mapError, onCompiled, onError],
  );

  // --- Debounced compilation ------------------------------------------------

  useEffect(() => {
    if (!autoCompile) return;

    if (!validateOnMount && expression === initialExpression) {
      // Skip initial compile if not requested.
      return;
    }

    if (debounceTimerRef.current != null) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    setIsCompiling(true);

    debounceTimerRef.current = setTimeout(() => {
      runCompile(expression);
    }, debounceMs);

    return () => {
      if (debounceTimerRef.current != null) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, [
    autoCompile,
    debounceMs,
    expression,
    initialExpression,
    runCompile,
    validateOnMount,
  ]);

  // --- Public API -----------------------------------------------------------

  const recompile = useCallback(() => runCompile(expression), [
    runCompile,
    expression,
  ]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const evaluate = useCallback(
    (ctx?: Context): Result => {
      const target = compiled ?? runCompile(expression);

      if (!target) {
        // If we still don't have a compiled expression, throw the last error
        // or a generic one.
        const err =
          error ??
          ({
            code: 'E_RUNTIME',
            message: 'SafExpr: expression is not valid or failed to compile.',
          } satisfies UseExpressionError);
        const e = new Error(err.message);
        throw e;
      }

      try {
        const context =
          (ctx as Context | undefined) ??
          (defaultContext as Context | undefined) ??
          ({} as Context);

        const result = target.eval(context);
        setHasResult(true);
        setLastResult(result);
        return result;
      } catch (err) {
        const mapped = mapError(err);
        setError(mapped);
        if (onError) {
          onError(mapped, err);
        }
        const e =
          err instanceof Error ? err : new Error(mapped.message || 'Error');
        throw e;
      }
    },
    [
      compiled,
      defaultContext,
      error,
      expression,
      mapError,
      onError,
      runCompile,
    ],
  );

  const isValid = !!compiled && !error;
  const hasError = !!error;

  const result: UseExpressionResult<Context, Result> = useMemo(
    () => ({
      expression,
      setExpression,
      compiled,
      isValid,
      hasError,
      error,
      isCompiling,
      lastResult,
      hasResult,
      recompile,
      evaluate,
      clearError,
    }),
    [
      expression,
      compiled,
      isValid,
      hasError,
      error,
      isCompiling,
      lastResult,
      hasResult,
      recompile,
      evaluate,
      clearError,
    ],
  );

  return result;
}

export default useExpression;
