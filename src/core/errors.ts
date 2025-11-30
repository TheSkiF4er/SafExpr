/**
 * SafExpr – Error types & helpers
 *
 * This module defines the core error type (`SafexprError`) used throughout
 * the library and a small set of utilities to create consistent, helpful
 * error messages.
 *
 * Goals:
 *  - One canonical error class for parser & evaluator.
 *  - Rich diagnostics: position, line/column, snippet with caret.
 *  - Stable error codes for programmatic handling.
 *
 * Common usage:
 *
 *  - Parser:
 *      throw createParseError({
 *        message: 'Unexpected token "*"',
 *        source,
 *        index: currentOffset,
 *      });
 *
 *  - Evaluator:
 *      throw createRuntimeError({
 *        message: 'Division by zero',
 *        source,
 *        index: node.start,
 *      });
 *
 * License: Apache-2.0
 * Author:  TheSkiF4er
 */

//////////////////////
// Error code enum  //
//////////////////////

/**
 * High-level error categories.
 *
 * Keep this list small and stable; detailed information should go into
 * the `message`, `note`, `snippet`, and optionally `cause`.
 */
export type SafexprErrorCode =
  /**
   * Syntax / parse-time problems:
   *  - invalid tokens, unterminated strings
   *  - unexpected operators
   *  - mismatched parentheses, etc.
   */
  | 'E_PARSE'
  /**
   * Expression runtime errors:
   *  - invalid arguments to user functions
   *  - unsafe operations detected at evaluation time
   *  - accessing missing properties (if configured to error)
   */
  | 'E_RUNTIME'
  /**
   * Security-related failures:
   *  - attempts to access forbidden globals (process, globalThis, window, …)
   *  - attempts to use dangerous keys (__proto__, constructor, prototype, …)
   */
  | 'E_SECURITY'
  /**
   * DoS / resource-limit violations:
   *  - expression too long
   *  - AST nesting too deep
   *  - too many evaluation operations
   */
  | 'E_DOS'
  /**
   * Internal / unexpected errors in the engine itself.
   * Reserved for invariants that should "never happen".
   */
  | 'E_INTERNAL';

/**
 * Options used when constructing a SafexprError.
 */
export interface SafexprErrorOptions {
  /**
   * High-level error category.
   */
  code: SafexprErrorCode;

  /**
   * Human-readable error message (short, single-line where possible).
   */
  message: string;

  /**
   * Optionally, the full original expression source string.
   */
  source?: string;

  /**
   * 0-based character offset in the source string where the error
   * originated (or is best represented).
   *
   * If omitted, `line`, `column` and `snippet` might be less precise.
   */
  index?: number;

  /**
   * Optional length (number of characters) of the offending span.
   * Used to draw a multi-character caret range in the snippet.
   */
  length?: number;

  /**
   * Optional explanatory note appended to the message in some UIs.
   * For example, suggestions or hints:
   *
   *   "did you mean '==' instead of '='?"
   */
  note?: string;

  /**
   * Optional underlying error (for wrapping). In modern runtimes this
   * may populate `error.cause`.
   */
  cause?: unknown;
}

/**
 * Enriched error shape – this is what users see when catching errors.
 *
 * It extends `Error` and adds:
 *  - `code`    – SafexprErrorCode
 *  - `index`   – 0-based index in the source
 *  - `line`    – 1-based line number
 *  - `column`  – 1-based column number
 *  - `snippet` – a textual snippet with the problematic line and caret(s)
 *  - `note`    – optional hint or suggestion
 */
export class SafexprError extends Error {
  public readonly name = 'SafexprError';
  public readonly code: SafexprErrorCode;

  /** 0-based offset in the source (if known). */
  public readonly index: number | null;

  /** 1-based line number (if known). */
  public readonly line: number | null;

  /** 1-based column number (if known). */
  public readonly column: number | null;

  /**
   * Human-friendly snippet with the expression line and a caret under the
   * offending segment, e.g.:
   *
   *   user.age >= 18 && && user.country == "US"
   *                        ^--- unexpected token "&&"
   */
  public readonly snippet: string;

  /**
   * Optional additional note or hint.
   */
  public readonly note?: string;

  constructor(opts: SafexprErrorOptions) {
    const { message, code, cause } = opts;
    super(message);

    // Fix prototype chain for `instanceof` in older JS environments
    Object.setPrototypeOf(this, new.target.prototype);

    this.code = code;

    const index =
      typeof opts.index === 'number' && opts.index >= 0 ? opts.index : null;

    // Compute line/column/snippet based on the source and index if available.
    let line: number | null = null;
    let column: number | null = null;
    let snippet = '';

    if (opts.source && index != null) {
      const snip = buildSnippet(opts.source, index, opts.length ?? 1, message);
      line = snip.line;
      column = snip.column;
      snippet = snip.snippet;
    } else {
      snippet = '';
    }

    this.index = index;
    this.line = line;
    this.column = column;
    this.snippet = snippet;
    this.note = opts.note;

    // Attach cause if supported (Node 16+, modern browsers).
    if (cause && !('cause' in this)) {
      // @ts-expect-error – not in older lib.dom.d.ts / ES libs
      this.cause = cause;
    }
  }
}

/**
 * Type guard for SafexprError.
 */
export function isSafexprError(err: unknown): err is SafexprError {
  return err instanceof SafexprError;
}

/////////////////////////////
// Public factory helpers  //
/////////////////////////////

/**
 * Create a parse-time error (syntax issues, invalid tokens, etc.).
 */
export function createParseError(
  opts: Omit<SafexprErrorOptions, 'code'>,
): SafexprError {
  return new SafexprError({ ...opts, code: 'E_PARSE' });
}

/**
 * Create a runtime error (issues discovered while evaluating an expression).
 */
export function createRuntimeError(
  opts: Omit<SafexprErrorOptions, 'code'>,
): SafexprError {
  return new SafexprError({ ...opts, code: 'E_RUNTIME' });
}

/**
 * Create a security error (forbidden globals, dangerous keys, etc.).
 */
export function createSecurityError(
  opts: Omit<SafexprErrorOptions, 'code'>,
): SafexprError {
  return new SafexprError({ ...opts, code: 'E_SECURITY' });
}

/**
 * Create a DoS / limit error (expression too large, too deep, too slow).
 */
export function createDosError(
  opts: Omit<SafexprErrorOptions, 'code'>,
): SafexprError {
  return new SafexprError({ ...opts, code: 'E_DOS' });
}

/**
 * Create an internal error (unexpected conditions / invariants).
 * This should not be exposed directly to end users in UIs, but it provides
 * a consistent shape for logging and debugging.
 */
export function createInternalError(
  opts: Omit<SafexprErrorOptions, 'code'>,
): SafexprError {
  return new SafexprError({ ...opts, code: 'E_INTERNAL' });
}

/////////////////////////////
// Snippet & position util //
/////////////////////////////

interface SnippetInfo {
  line: number;
  column: number;
  snippet: string;
}

/**
 * Compute line and column for a given index in the source string.
 *
 * - Lines are 1-based.
 * - Columns are 1-based.
 *
 * This is intentionally simple and scans the string once – perfectly fine
 * for typical expression sizes.
 */
export function computeLineAndColumn(
  source: string,
  index: number,
): { line: number; column: number } {
  index = clamp(index, 0, Math.max(0, source.length - 1));

  let line = 1;
  let lastLineStart = 0;

  for (let i = 0; i < source.length && i < index; i++) {
    const ch = source.charCodeAt(i);
    // \n (LF) or \r (CR). Treat CRLF as a single line break for simplicity.
    if (ch === 10 /* \n */) {
      line++;
      lastLineStart = i + 1;
    } else if (ch === 13 /* \r */) {
      line++;
      // If next char is \n, skip it.
      if (i + 1 < source.length && source.charCodeAt(i + 1) === 10) {
        i++;
      }
      lastLineStart = i + 1;
    }
  }

  const column = index - lastLineStart + 1;
  return { line, column };
}

/**
 * Build a user-friendly snippet showing the line where the error occurred,
 * and one or more carets under the offending span.
 *
 * Example output:
 *
 *   user.age >= 18 && && user.country == "US"
 *                        ^--- Unexpected token "&&"
 */
export function buildSnippet(
  source: string,
  index: number,
  length: number,
  messageForArrow: string,
): SnippetInfo {
  const { line, column } = computeLineAndColumn(source, index);
  const lines = splitLinesPreserving(source);

  const lineIndex = line - 1;
  const errorLine = lines[lineIndex] ?? '';

  // Compute caret range, clamped to the line length
  const startCol = clamp(column, 1, Math.max(errorLine.length, 1));
  const caretLength = Math.max(1, Math.min(length, errorLine.length - startCol + 1));

  // Build caret line: spaces then one or more carets
  const spaces = ' '.repeat(startCol - 1);
  const carets = '^'.repeat(caretLength);

  // Add a short message after the first caret when possible
  const arrowMessage =
    messageForArrow && messageForArrow.trim().length > 0
      ? ` --- ${messageForArrow}`
      : '';

  const caretLine = `${spaces}${carets}${arrowMessage}`;

  const snippet = `${errorLine}\n${caretLine}`;

  return { line, column, snippet };
}

/**
 * Simple clamp utility.
 */
function clamp(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) return min;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

/**
 * Split a string into lines, preserving content without the linebreak
 * characters themselves.
 *
 * Supports \n, \r\n and \r. This is intentionally minimal.
 */
function splitLinesPreserving(source: string): string[] {
  const lines: string[] = [];
  let start = 0;

  for (let i = 0; i < source.length; i++) {
    const ch = source.charCodeAt(i);
    if (ch === 10 /* \n */ || ch === 13 /* \r */) {
      lines.push(source.slice(start, i));

      // Handle CRLF as a single newline
      if (
        ch === 13 /* \r */ &&
        i + 1 < source.length &&
        source.charCodeAt(i + 1) === 10 /* \n */
      ) {
        i++;
      }

      start = i + 1;
    }
  }

  // last line (or entire string if no line breaks)
  if (start <= source.length) {
    lines.push(source.slice(start));
  }

  return lines;
}
