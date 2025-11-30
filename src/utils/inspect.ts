/**
 * SafExpr – Utils / inspect
 *
 * Convenience helpers for:
 *  - Introspecting expressions (AST-level).
 *  - Pretty-printing values (for logs / debug UIs).
 *  - Formatting SafExpr errors with context.
 *
 * This module has **no runtime dependency** on the evaluator – it only
 * works with AST, compiled expressions, and plain values.
 *
 * License: Apache-2.0
 * Author:  TheSkiF4er
 */

import type {
  ExpressionNode,
  CompiledExpression,
  Engine,
  EngineOptions,
} from '../core/types';
import { createEngine } from '../core/engine';
import {
  SafexprError,
  isSafexprError,
  computeLineAndColumn,
  buildSnippet,
} from '../core/errors';

/////////////////////////////
// Value inspection        //
/////////////////////////////

export interface InspectValueOptions {
  /**
   * Maximum depth for object/array traversal.
   * Default: 3
   */
  maxDepth?: number;

  /**
   * Maximum number of array elements to display per level.
   * Default: 10
   */
  maxArrayLength?: number;

  /**
   * Maximum number of object keys to display per level.
   * Default: 10
   */
  maxObjectKeys?: number;

  /**
   * Maximum number of characters for strings.
   * Longer strings are truncated with "…".
   * Default: 80
   */
  maxStringLength?: number;

  /**
   * Indentation string used for pretty-printing nested structures.
   * Default: '  ' (two spaces)
   */
  indent?: string;
}

/**
 * Pretty-print an arbitrary JS value for logs, debug output, or UIs.
 *
 * This is **safe**:
 *  - Handles circular references.
 *  - Truncates deep / large structures by default.
 */
export function inspectValue(
  value: unknown,
  options: InspectValueOptions = {},
): string {
  const {
    maxDepth = 3,
    maxArrayLength = 10,
    maxObjectKeys = 10,
    maxStringLength = 80,
    indent = '  ',
  } = options;

  const seen = new WeakSet<object>();

  function format(val: unknown, depth: number, path: string): string {
    // Primitive & simple cases
    if (val === null) return 'null';
    if (val === undefined) return 'undefined';

    const t = typeof val;
    if (t === 'string') {
      const s = val as string;
      const short =
        s.length > maxStringLength ? s.slice(0, maxStringLength) + '…' : s;
      return JSON.stringify(short);
    }
    if (t === 'number' || t === 'boolean' || t === 'bigint') {
      return String(val);
    }
    if (t === 'symbol') {
      return val.toString();
    }
    if (t === 'function') {
      const name = (val as Function).name || '<anonymous>';
      return `[Function ${name}]`;
    }

    // Objects
    if (typeof val === 'object') {
      const obj = val as Record<string, unknown>;

      if (seen.has(obj)) {
        return `[Circular${path ? ` ~ ${path}` : ''}]`;
      }

      seen.add(obj);

      // Date
      if (obj instanceof Date) {
        return `Date(${isNaN(obj.getTime()) ? 'Invalid' : obj.toISOString()})`;
      }

      // Array
      if (Array.isArray(obj)) {
        if (depth >= maxDepth) {
          return `[Array(${obj.length})]`;
        }

        const items: string[] = [];
        const len = Math.min(obj.length, maxArrayLength);
        for (let i = 0; i < len; i++) {
          items.push(
            indent.repeat(depth + 1) +
              format(obj[i], depth + 1, `${path}[${i}]`),
          );
        }
        if (obj.length > len) {
          items.push(
            indent.repeat(depth + 1) +
              `… ${obj.length - len} more item(s)`,
          );
        }

        if (items.length === 0) return '[]';

        return `[\n${items.join(',\n')}\n${indent.repeat(depth)}]`;
      }

      // Plain-ish object
      if (depth >= maxDepth) {
        const keys = Object.keys(obj);
        return `{… ${keys.length} key(s)}`;
      }

      const entries: string[] = [];
      const keys = Object.keys(obj);
      const len = Math.min(keys.length, maxObjectKeys);

      for (let i = 0; i < len; i++) {
        const key = keys[i];
        const v = obj[key];
        entries.push(
          `${indent.repeat(depth + 1)}${JSON.stringify(
            key,
          )}: ${format(v, depth + 1, `${path}.${key}`)}`,
        );
      }

      if (keys.length > len) {
        entries.push(
          indent.repeat(depth + 1) +
            `… ${keys.length - len} more key(s)`,
        );
      }

      if (entries.length === 0) return '{}';

      return `{\n${entries.join(',\n')}\n${indent.repeat(depth)}}`;
    }

    // Fallback
    try {
      return JSON.stringify(val);
    } catch {
      return String(val);
    }
  }

  return format(value, 0, '');
}

/////////////////////////////
// SafExpr error formatting //
/////////////////////////////

export interface FormattedSafexprError {
  /**
   * Compact single-line summary.
   */
  summary: string;

  /**
   * Multi-line human-friendly message with snippet, if available.
   */
  detail: string;

  /**
   * Raw error (SafexprError or unknown).
   */
  error: unknown;
}

/**
 * Format a SafExpr error (or arbitrary error) into a structured,
 * user-friendly object.
 *
 * If `source` is provided and the error does not already contain a snippet,
 * this function will attempt to compute one using `index`.
 */
export function formatSafexprError(
  err: unknown,
  source?: string,
): FormattedSafexprError {
  if (!isSafexprError(err)) {
    const message =
      err instanceof Error && typeof err.message === 'string'
        ? err.message
        : String(err);
    const summary = `Error: ${message}`;
    return {
      summary,
      detail: summary,
      error: err,
    };
  }

  const e = err as SafexprError;
  const code = e.code;
  const message = e.message || 'SafExpr error';

  let line = e.line;
  let column = e.column;
  let snippet = e.snippet;

  // If snippet is missing but we have source + index, build one.
  if ((!snippet || snippet.trim() === '') && source && e.index != null) {
    const extraSnippet = buildSnippet(
      source,
      e.index,
      1,
      message,
    );
    line = extraSnippet.line;
    column = extraSnippet.column;
    snippet = extraSnippet.snippet;
  }

  // Normalize line/column if still undefined but we know index.
  if ((line == null || column == null) && source && e.index != null) {
    const lc = computeLineAndColumn(source, e.index);
    line = lc.line;
    column = lc.column;
  }

  const locationParts: string[] = [];
  if (line != null) locationParts.push(`line ${line}`);
  if (column != null) locationParts.push(`col ${column}`);
  const at =
    locationParts.length > 0 ? ` at ${locationParts.join(', ')}` : '';

  const summary = `[${code}] ${message}${at}`;

  let detail = summary;

  if (snippet && snippet.trim() !== '') {
    detail += `\n\n${snippet}`;
  }

  if (e.note && e.note.trim() !== '') {
    detail += `\n\nHint: ${e.note}`;
  }

  return {
    summary,
    detail,
    error: err,
  };
}

/////////////////////////////
// Expression introspection //
/////////////////////////////

export interface ExpressionAstInsight {
  /**
   * Total number of AST nodes.
   */
  nodeCount: number;

  /**
   * Maximum AST depth (root = 1).
   */
  maxDepth: number;

  /**
   * All identifier names encountered in the expression.
   *
   * Includes:
   *  - context fields (e.g. user, order)
   *  - helper names used as identifiers (also listed in `helpers`)
   *
   * Sorted, unique.
   */
  identifiers: string[];

  /**
   * All helper function names that appear as call callees.
   *
   * Example: `sum(prices) + max(discounts)` → ["sum", "max"]
   *
   * Sorted, unique.
   */
  helpers: string[];

  /**
   * Static member access paths discovered in the AST.
   *
   * Examples:
   *  - user.age
   *  - order.total.amount
   *
   * Only paths with non-computed properties are included.
   */
  memberPaths: string[];
}

/**
 * Multi-line, human-readable description of an expression and its AST.
 *
 * Useful for debug logs or inspection UIs.
 */
export function inspectCompiledExpression<
  Context = unknown,
  Result = unknown,
>(
  compiled: CompiledExpression<Context, Result>,
): string {
  const { source, ast } = compiled;
  const insight = analyzeAst(ast);

  const lines: string[] = [];

  lines.push('SafExpr: compiled expression');
  lines.push('──────────────────────────');
  lines.push(`Source: ${JSON.stringify(source)}`);
  lines.push('');
  lines.push(`Nodes: ${insight.nodeCount}`);
  lines.push(`Depth: ${insight.maxDepth}`);
  lines.push(
    `Identifiers: ${
      insight.identifiers.length
        ? insight.identifiers.join(', ')
        : '—'
    }`,
  );
  lines.push(
    `Helpers: ${
      insight.helpers.length ? insight.helpers.join(', ') : '—'
    }`,
  );
  lines.push(
    `Member paths: ${
      insight.memberPaths.length
        ? insight.memberPaths.join(', ')
        : '—'
    }`,
  );

  return lines.join('\n');
}

/**
 * Analyze an AST and extract high-level information.
 *
 * This is **pure** and does not depend on the engine or evaluator.
 */
export function analyzeAst(root: ExpressionNode): ExpressionAstInsight {
  let nodeCount = 0;
  let maxDepth = 0;

  const identifiers = new Set<string>();
  const helpers = new Set<string>();
  const memberPaths = new Set<string>();

  function visit(node: ExpressionNode, depth: number): void {
    nodeCount++;
    if (depth > maxDepth) maxDepth = depth;

    switch (node.type) {
      case 'Literal':
        // No children.
        return;

      case 'Identifier': {
        identifiers.add(node.name);
        return;
      }

      case 'UnaryExpression': {
        visit(node.argument, depth + 1);
        return;
      }

      case 'BinaryExpression': {
        visit(node.left, depth + 1);
        visit(node.right, depth + 1);
        return;
      }

      case 'LogicalExpression': {
        visit(node.left, depth + 1);
        visit(node.right, depth + 1);
        return;
      }

      case 'NullishCoalescingExpression': {
        visit(node.left, depth + 1);
        visit(node.right, depth + 1);
        return;
      }

      case 'ConditionalExpression': {
        visit(node.test, depth + 1);
        visit(node.consequent, depth + 1);
        visit(node.alternate, depth + 1);
        return;
      }

      case 'MemberExpression': {
        // Record static path if possible.
        const path = extractMemberPath(node);
        if (path) {
          path.forEach((seg) => identifiers.add(seg));
          memberPaths.add(path.join('.'));
        }

        visit(node.object, depth + 1);
        visit(node.property, depth + 1);
        return;
      }

      case 'CallExpression': {
        // Helper name, if callee is identifier.
        if (node.callee.type === 'Identifier') {
          helpers.add(node.callee.name);
          identifiers.add(node.callee.name);
        } else {
          visit(node.callee, depth + 1);
        }

        for (const arg of node.arguments) {
          visit(arg, depth + 1);
        }
        return;
      }

      case 'ArrayExpression': {
        for (const el of node.elements) {
          visit(el, depth + 1);
        }
        return;
      }

      case 'ObjectExpression': {
        for (const prop of node.properties) {
          visit(prop, depth + 1);
        }
        return;
      }

      case 'Property': {
        visit(node.key, depth + 1);
        visit(node.value, depth + 1);
        return;
      }

      default: {
        // Exhaustiveness guard
        const _never: never = node;
        return _never;
      }
    }
  }

  visit(root, 1);

  return {
    nodeCount,
    maxDepth,
    identifiers: Array.from(identifiers).sort(),
    helpers: Array.from(helpers).sort(),
    memberPaths: Array.from(memberPaths).sort(),
  };
}

/**
 * Try to extract a static member path from a MemberExpression.
 *
 * Example:
 *   user.age              → ["user", "age"]
 *   order.total.amount    → ["order", "total", "amount"]
 *   obj["dynamic"][x]     → null (computed)
 */
function extractMemberPath(node: ExpressionNode): string[] | null {
  if (node.type !== 'MemberExpression') return null;

  // The property must be non-computed and identifier-like.
  if (node.computed) return null;

  const segments: string[] = [];

  // Collect property segment
  if (node.property.type === 'Identifier') {
    segments.unshift(node.property.name);
  } else {
    return null;
  }

  // Walk back through the object chain
  let current: ExpressionNode | undefined = node.object;

  while (current) {
    if (current.type === 'Identifier') {
      segments.unshift(current.name);
      return segments;
    }

    if (current.type === 'MemberExpression' && !current.computed) {
      if (current.property.type !== 'Identifier') {
        return null;
      }
      segments.unshift(current.property.name);
      current = current.object;
      continue;
    }

    // Anything else (call, computed member, etc.) breaks the static path.
    return null;
  }

  return null;
}

/////////////////////////////
// High-level source helper //
/////////////////////////////

export interface InspectSourceOptions extends InspectValueOptions {
  /**
   * Custom engine to use for compilation.
   *
   * If omitted, a new engine is created with `engineOptions`.
   */
  engine?: Engine;

  /**
   * Engine options used when creating a new engine.
   */
  engineOptions?: EngineOptions;
}

/**
 * Convenience helper: compile a source expression, analyze its AST,
 * and return a human-readable report string.
 *
 * This is ideal for ad-hoc debugging, playgrounds, or tooling.
 */
export function inspectSourceExpression<
  Context = unknown,
  Result = unknown,
>(
  source: string,
  options: InspectSourceOptions = {},
): string {
  const { engine: providedEngine, engineOptions } = options;
  const engine = providedEngine ?? createEngine(engineOptions);

  let compiled: CompiledExpression<Context, Result>;
  try {
    compiled = engine.compile<Context, Result>(source);
  } catch (err) {
    const formatted = formatSafexprError(err, source);
    return [
      'SafExpr: failed to compile expression',
      '─────────────────────────────────────',
      `Source: ${JSON.stringify(source)}`,
      '',
      formatted.detail,
    ].join('\n');
  }

  const summary = inspectCompiledExpression(compiled);

  return summary;
        }
