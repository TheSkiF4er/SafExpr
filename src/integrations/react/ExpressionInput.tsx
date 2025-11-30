/**
 * SafExpr – React integration / ExpressionInput
 *
 * A reusable React component for editing and validating SafExpr expressions.
 *
 * Features:
 *  - Live syntax validation (with debounce).
 *  - Pretty error rendering (line, column, snippet).
 *  - Hooks for accessing compiled expressions.
 *  - Works with a custom Engine or a default internal Engine.
 *
 * Typical usage:
 *
 *   import React, { useState } from 'react';
 *   import { ExpressionInput } from 'safexpr/src/integrations/react/ExpressionInput';
 *
 *   export function RuleEditor() {
 *     const [expr, setExpr] = useState('price * qty');
 *
 *     return (
 *       <ExpressionInput
 *         label="Discount rule"
 *         value={expr}
 *         onChange={setExpr}
 *       />
 *     );
 *   }
 *
 * License: Apache-2.0
 * Author:  TheSkiF4er
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { createEngine } from '../../core/engine';
import type {
  Engine,
  CompiledExpression,
} from '../../core/engine';
import { SafexprError, isSafexprError } from '../../core/errors';

//////////////////////
// Types & helpers  //
//////////////////////

/**
 * Result of validating an expression.
 */
export interface ExpressionValidationResult<Context = unknown, Result = unknown> {
  ok: boolean;
  /**
   * Compiled expression, if validation succeeded.
   */
  compiled?: CompiledExpression<Context, Result>;
  /**
   * SafExpr error description, if validation failed.
   */
  error?: {
    code: string;
    message: string;
    line?: number | null;
    column?: number | null;
    snippet?: string;
    note?: string;
  };
}

/**
 * Props for the ExpressionInput component.
 */
export interface ExpressionInputProps<
  Context = Record<string, unknown>,
  Result = unknown,
> {
  /**
   * Expression string (controlled value).
   */
  value: string;

  /**
   * Update handler for the expression value.
   */
  onChange?(value: string): void;

  /**
   * Optional label rendered above the text area.
   */
  label?: string;

  /**
   * Optional description rendered below the label.
   */
  helperText?: string;

  /**
   * Placeholder for the input.
   */
  placeholder?: string;

  /**
   * Custom SafExpr Engine. If omitted, a default engine instance is used.
   */
  engine?: Engine;

  /**
   * Called after every validation (debounced).
   */
  onValidationResult?(
    result: ExpressionValidationResult<Context, Result>,
  ): void;

  /**
   * Called whenever the expression is valid and successfully compiled.
   */
  onCompiled?(compiled: CompiledExpression<Context, Result>): void;

  /**
   * If true (default), validation runs automatically as the user types.
   */
  autoValidate?: boolean;

  /**
   * Debounce interval for validation in milliseconds.
   * Default: 250 ms.
   */
  debounceMs?: number;

  /**
   * Number of rows for the textarea.
   * Default: 3.
   */
  textareaRows?: number;

  /**
   * If true, shows extra details like line/column and snippet.
   * Default: true.
   */
  showErrorDetails?: boolean;

  /**
   * Additional className for the root container.
   */
  className?: string;

  /**
   * Additional className for the textarea element.
   */
  textareaClassName?: string;

  /**
   * Whether the input should be read-only.
   */
  readOnly?: boolean;

  /**
   * Whether the input should be disabled.
   */
  disabled?: boolean;

  /**
   * Optional prefix element (e.g. a label badge).
   */
  prefix?: React.ReactNode;

  /**
   * Optional suffix element (e.g. buttons, icons).
   */
  suffix?: React.ReactNode;
}

/**
 * Minimal engine shared by all ExpressionInput instances when a custom
 * engine is not provided.
 */
const defaultEngine: Engine = createEngine();

//////////////////////
// Component        //
//////////////////////

export function ExpressionInput<
  Context = Record<string, unknown>,
  Result = unknown,
>(props: ExpressionInputProps<Context, Result>) {
  const {
    value,
    onChange,
    label,
    helperText,
    placeholder,
    engine = defaultEngine,
    onValidationResult,
    onCompiled,
    autoValidate = true,
    debounceMs = 250,
    textareaRows = 3,
    showErrorDetails = true,
    className,
    textareaClassName,
    readOnly,
    disabled,
    prefix,
    suffix,
  } = props;

  const [isDirty, setIsDirty] = useState(false);
  const [validation, setValidation] =
    useState<ExpressionValidationResult<Context, Result> | null>(null);

  const debounceTimerRef = useRef<number | null>(null);

  const hasError = validation?.ok === false;
  const error = validation?.error;

  const statusText = useMemo(() => {
    if (!isDirty || value.trim() === '') {
      return '';
    }
    if (validation == null) return 'Validating…';
    if (validation.ok) return 'Expression is valid';
    return 'Expression has errors';
  }, [isDirty, value, validation]);

  const runValidation = useCallback(() => {
    if (!autoValidate) return;

    if (value.trim() === '') {
      const result: ExpressionValidationResult<Context, Result> = {
        ok: true,
      };
      setValidation(result);
      onValidationResult?.(result);
      return;
    }

    try {
      const compiled = engine.compile<Context, Result>(value);
      const result: ExpressionValidationResult<Context, Result> = {
        ok: true,
        compiled,
      };
      setValidation(result);
      onValidationResult?.(result);
      onCompiled?.(compiled);
    } catch (err) {
      if (isSafexprError(err)) {
        const se = err as SafexprError;
        const result: ExpressionValidationResult<Context, Result> = {
          ok: false,
          error: {
            code: se.code,
            message: se.message,
            line: se.line ?? undefined,
            column: se.column ?? undefined,
            snippet: se.snippet || undefined,
            note: se.note || undefined,
          },
        };
        setValidation(result);
        onValidationResult?.(result);
      } else {
        const msg =
          err instanceof Error && typeof err.message === 'string'
            ? err.message
            : String(err);
        const result: ExpressionValidationResult<Context, Result> = {
          ok: false,
          error: {
            code: 'E_RUNTIME',
            message: msg,
          },
        };
        setValidation(result);
        onValidationResult?.(result);
      }
    }
  }, [autoValidate, engine, onCompiled, onValidationResult, value]);

  // Debounced validation effect
  useEffect(() => {
    if (!autoValidate) return;

    if (debounceTimerRef.current != null) {
      window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    debounceTimerRef.current = window.setTimeout(
      () => runValidation(),
      debounceMs,
    );

    return () => {
      if (debounceTimerRef.current != null) {
        window.clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, [autoValidate, debounceMs, runValidation, value]);

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      const next = event.target.value;
      setIsDirty(true);
      onChange?.(next);
    },
    [onChange],
  );

  const borderColor = hasError ? '#e11d48' : '#4b5563';
  const labelColor = hasError ? '#b91c1c' : '#111827';

  return (
    <div
      className={className}
      style={{
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      {(label || prefix || suffix) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: 8,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {prefix && <span>{prefix}</span>}
            {label && (
              <label
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: labelColor,
                }}
              >
                {label}
              </label>
            )}
          </div>
          {suffix && <div>{suffix}</div>}
        </div>
      )}

      {helperText && (
        <p
          style={{
            margin: 0,
            fontSize: 12,
            color: '#6b7280',
          }}
        >
          {helperText}
        </p>
      )}

      <textarea
        value={value}
        onChange={handleChange}
        rows={textareaRows}
        placeholder={placeholder}
        readOnly={readOnly}
        disabled={disabled}
        aria-invalid={hasError || undefined}
        className={textareaClassName}
        style={{
          width: '100%',
          resize: 'vertical',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
          fontSize: 13,
          lineHeight: 1.4,
          padding: '8px 10px',
          borderRadius: 6,
          borderWidth: 1,
          borderStyle: 'solid',
          borderColor,
          outline: 'none',
          backgroundColor: disabled ? '#f9fafb' : '#ffffff',
          color: '#111827',
          boxShadow: '0 0 0 1px rgba(0,0,0,0.02)',
        }}
        onBlur={() => {
          if (!autoValidate) {
            runValidation();
          }
        }}
        onFocus={() => {
          // Mark dirty once the user starts interacting with the field
          if (!isDirty && value.trim() !== '') {
            setIsDirty(true);
          }
        }}
      />

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          marginTop: 2,
        }}
      >
        {statusText && (
          <div
            style={{
              fontSize: 11,
              color: hasError ? '#b91c1c' : '#6b7280',
            }}
          >
            {statusText}
          </div>
        )}

        {hasError && error && (
          <div
            style={{
              padding: 8,
              borderRadius: 6,
              backgroundColor: '#fef2f2',
              border: '1px solid #fecaca',
              fontSize: 11,
              color: '#991b1b',
              whiteSpace: 'pre-wrap',
              overflowX: 'auto',
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 4 }}>
              {error.code}: {error.message}
            </div>

            {showErrorDetails && (
              <>
                {(error.line != null || error.column != null) && (
                  <div style={{ marginBottom: 4 }}>
                    {error.line != null && (
                      <span>Line {error.line}</span>
                    )}
                    {error.line != null && error.column != null && <span> · </span>}
                    {error.column != null && (
                      <span>Column {error.column}</span>
                    )}
                  </div>
                )}

                {error.snippet && (
                  <pre
                    style={{
                      margin: 0,
                      marginBottom: 4,
                      padding: 6,
                      borderRadius: 4,
                      backgroundColor: '#fee2e2',
                      color: '#7f1d1d',
                      fontFamily:
                        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                      fontSize: 11,
                      overflowX: 'auto',
                    }}
                  >
                    {error.snippet}
                  </pre>
                )}

                {error.note && (
                  <div style={{ color: '#b45309' }}>
                    {error.note}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default ExpressionInput;
