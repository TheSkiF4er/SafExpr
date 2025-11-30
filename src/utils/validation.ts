/**
 * SafExpr – Utils / validation
 *
 * High-level helpers for validating SafExpr expressions beyond what the core
 * parser / evaluator already enforce.
 *
 * Use cases:
 *  - Enforce stricter limits (AST depth, node count).
 *  - Restrict which helper functions can be used in expressions.
 *  - Restrict which identifiers / member roots can be referenced.
 *  - Build custom “linting” / validation rules for rule editors.
 *
 * This module works purely on AST + compiled expressions; it does not perform
 * any evaluation.
 *
 * License: Apache-2.0
 * Author:  TheSkiF4er
 */

import type {
  ExpressionNode,
  Engine,
  EngineOptions,
  CompiledExpression,
  DiagnosticLocation,
} from '../core/types';
import { createEngine } from '../core/engine';
import {
  SafexprError,
  isSafexprError,
  computeLineAndColumn,
} from '../core/errors';

/////////////////////////////
// Public types            //
/////////////////////////////

/**
 * Severity of a validation issue.
 */
export type IssueSeverity = 'error' | 'warning' | 'info';

/**
 * Single validation / lint issue for an expression.
 */
export interface ExpressionValidationIssue {
  /**
   * Machine-readable code, e.g. "VAL_MAX_DEPTH" or "VAL_FORBIDDEN_HELPER".
   *
   * You can use these codes to group or filter issues in your UI.
   */
  code: string;

  /**
   * Human-readable message.
   */
  message: string;

  /**
   * Optional extra hint or suggestion.
   */
  note?: string;

  /**
   * Severity (error / warning / info).
   *
   * - error   → expression should be considered invalid
   * - warning → expression is valid, but likely problematic
   * - info    → additional information / stylistic hints
   */
  severity: IssueSeverity;

  /**
   * Optional location in the original source (if available).
   */
  location?: DiagnosticLocation;

  /**
   * Optional rule identifier (e.g. "maxDepth", "allowedHelpers").
   * This can help you map issues back to which rule produced them.
   */
  rule?: string;

  /**
   * Arbitrary additional metadata.
   */
  meta?: Record<string, unknown>;
}

/**
 * Aggregate statistics about an AST, computed during validation.
 */
export interface ExpressionValidationStats {
  /**
   * Total number of AST nodes visited.
   */
  nodeCount: number;

  /**
   * Maximum AST depth (root = 1).
   */
  maxDepth: number;

  /**
   * Total number of identifier nodes.
   */
  totalIdentifiers: number;

  /**
   * Total number of call expressions (helper calls).
   */
  totalHelperCalls: number;

  /**
   * Total number of MemberExpression nodes.
   */
  totalMemberExpressions: number;
}

/**
 * Result of validating an expression.
 */
export interface ExpressionValidationResult {
  /**
   * Whether the expression is considered valid.
   *
   * This is simply `issues.every(i => i.severity !== 'error')`.
   */
  ok: boolean;

  /**
   * All issues found during validation (possibly empty).
   */
  issues: ExpressionValidationIssue[];

  /**
   * Stats about the AST.
   */
  stats: ExpressionValidationStats;
}

/**
 * Configuration options for AST-level validation.
 *
 * Notes:
 *  - All limits are *soft*; violating them produces issues, it does not
 *    throw exceptions.
 *  - String comparisons are case-sensitive by default.
 */
export interface ExpressionValidationOptions {
  /**
   * Optional source string that produced the AST.
   * If present, line/column are computed for issue locations.
   */
  source?: string;

  /**
   * Maximum allowed AST depth (root = 1).
   * If exceeded, a VAL_MAX_DEPTH error is produced.
   */
  maxAstDepth?: number;

  /**
   * Maximum allowed number of nodes in the AST.
   * If exceeded, a VAL_MAX_NODE_COUNT error is produced.
   */
  maxNodeCount?: number;

  /**
   * Maximum length (in characters) for identifier names.
   * Longer identifiers produce VAL_IDENTIFIER_TOO_LONG warnings.
   */
  maxIdentifierLength?: number;

  /**
   * Maximum number of segments in a static member path.
   *
   * Example:
   *   user.profile.birthDate → 3 segments
   *
   * If exceeded, a VAL_MEMBER_PATH_TOO_DEEP warning is produced.
   */
  maxMemberPathSegments?: number;

  /**
   * Explicit allow-list of helper function names.
   *
   * Any helper call whose callee is not in this list produces
   * a VAL_HELPER_NOT_ALLOWED error.
   *
   * Ignored if empty / undefined.
   */
  allowedHelpers?: string[];

  /**
   * Explicit deny-list of helper function names.
   *
   * Any helper call whose callee *is* in this list produces
   * a VAL_HELPER_FORBIDDEN error.
   *
   * Ignored if empty / undefined.
   */
  forbiddenHelpers?: string[];

  /**
   * Explicit allow-list of identifier names.
   *
   * Any identifier whose name is not in this list produces
   * a VAL_IDENTIFIER_NOT_ALLOWED error.
   *
   * Ignored if empty / undefined.
   */
  allowedIdentifiers?: string[];

  /**
   * Explicit deny-list of identifier names.
   *
   * Any identifier whose name *is* in this list produces
   * a VAL_IDENTIFIER_FORBIDDEN error.
   *
   * Ignored if empty / undefined.
   */
  forbiddenIdentifiers?: string[];

  /**
   * Allow-list for the *root* segment of member paths.
   *
   * Example:
   *   with allowedMemberRoots = ["user", "order"]
   *   - user.age      → OK
   *   - order.total   → OK
   *   - tenant.id     → VAL_MEMBER_ROOT_NOT_ALLOWED
   */
  allowedMemberRoots?: string[];

  /**
   * Deny-list for the *root* segment of member paths.
   *
   * Example:
   *   forbiddenMemberRoots = ["internal", "debug"]
   */
  forbiddenMemberRoots?: string[];
}

/**
 * Options for validating a *source string* (compile + validate).
 */
export interface ValidateSourceExpressionOptions<
  Context = unknown,
  Result = unknown,
> extends ExpressionValidationOptions {
  /**
   * Existing engine instance to use for compilation.
   * If omitted, a new engine is created with `engineOptions`.
   */
  engine?: Engine;

  /**
   * Engine options used when creating a new engine.
   */
  engineOptions?: EngineOptions;

  /**
   * If true, compilation errors are surfaced as validation issues instead
   * of being thrown.
   *
   * Default: true.
   */
  captureCompileErrorsAsIssues?: boolean;
}

/**
 * Result of validating a source expression.
 */
export interface SourceExpressionValidationResult<
  Context = unknown,
  Result = unknown,
> extends ExpressionValidationResult {
  /**
   * Compiled expression, if compilation succeeded.
   */
  compiled?: CompiledExpression<Context, Result>;

  /**
   * AST root node, if compilation succeeded.
   */
  ast?: ExpressionNode;
}

/////////////////////////////
// AST-level validation    //
/////////////////////////////

/**
 * Validate a pre-parsed AST using the given options.
 *
 * Does **not** throw on validation failures; instead, returns a
 * structured list of issues.
 */
export function validateAst(
  ast: ExpressionNode,
  options: ExpressionValidationOptions = {},
): ExpressionValidationResult {
  const {
    source,
    maxAstDepth,
    maxNodeCount,
    maxIdentifierLength,
    maxMemberPathSegments,
    allowedHelpers,
    forbiddenHelpers,
    allowedIdentifiers,
    forbiddenIdentifiers,
    allowedMemberRoots,
    forbiddenMemberRoots,
  } = options;

  const issues: ExpressionValidationIssue[] = [];

  let nodeCount = 0;
  let maxDepthSeen = 0;
  let totalIdentifiers = 0;
  let totalHelperCalls = 0;
  let totalMemberExpressions = 0;

  // Aggregated sets/maps for post-visit checks.
  const identifiers = new Map<
    string,
    { count: number; index: number; length: number }
  >();
  const helpers = new Map<
    string,
    { count: number; index: number; length: number }
  >();
  const memberRoots = new Map<
    string,
    { count: number; index: number; length: number }
  >();
  const memberPaths: {
    path: string[];
    index: number;
    length: number;
  }[] = [];

  let depthViolationRecorded = false;
  let nodeCountViolationRecorded = false;

  const sourceLength = typeof source === 'string' ? source.length : 0;

  const makeLocation = (
    index: number,
    length: number,
  ): DiagnosticLocation | undefined => {
    if (index < 0) return undefined;
    const loc: DiagnosticLocation = { index, length };

    if (source && sourceLength > 0) {
      const lc = computeLineAndColumn(source, index);
      loc.line = lc.line;
      loc.column = lc.column;
    }

    return loc;
  };

  const visit = (node: ExpressionNode, depth: number): void => {
    nodeCount++;
    if (depth > maxDepthSeen) maxDepthSeen = depth;

    // Enforce per-node limits.
    if (
      typeof maxNodeCount === 'number' &&
      maxNodeCount >= 0 &&
      nodeCount > maxNodeCount &&
      !nodeCountViolationRecorded
    ) {
      nodeCountViolationRecorded = true;
      issues.push({
        code: 'VAL_MAX_NODE_COUNT',
        rule: 'maxNodeCount',
        severity: 'error',
        message: `Expression AST has more nodes than allowed (limit: ${maxNodeCount}).`,
        note:
          'Consider simplifying the expression or splitting it into multiple smaller rules.',
        location: makeLocation(node.start, Math.max(1, node.end - node.start)),
        meta: {
          nodeCount,
          maxNodeCount,
        },
      });
    }

    if (
      typeof maxAstDepth === 'number' &&
      maxAstDepth >= 0 &&
      depth > maxAstDepth &&
      !depthViolationRecorded
    ) {
      depthViolationRecorded = true;
      issues.push({
        code: 'VAL_MAX_DEPTH',
        rule: 'maxAstDepth',
        severity: 'error',
        message: `Expression exceeds maximum allowed depth (limit: ${maxAstDepth}).`,
        note:
          'Deeply nested expressions are harder to read and can be more expensive to evaluate.',
        location: makeLocation(node.start, Math.max(1, node.end - node.start)),
        meta: {
          depth,
          maxAstDepth,
        },
      });
    }

    switch (node.type) {
      case 'Literal':
        return;

      case 'Identifier': {
        totalIdentifiers++;
        const name = node.name;
        const existing = identifiers.get(name);
        if (!existing) {
          identifiers.set(name, {
            count: 1,
            index: node.start,
            length: node.end - node.start,
          });
        } else {
          existing.count++;
        }

        if (
          typeof maxIdentifierLength === 'number' &&
          maxIdentifierLength >= 0 &&
          name.length > maxIdentifierLength
        ) {
          issues.push({
            code: 'VAL_IDENTIFIER_TOO_LONG',
            rule: 'maxIdentifierLength',
            severity: 'warning',
            message: `Identifier "${name}" is longer than the recommended limit (${maxIdentifierLength} characters).`,
            note: 'Consider using shorter field names for better readability.',
            location: makeLocation(node.start, node.end - node.start),
            meta: {
              name,
              length: name.length,
              maxIdentifierLength,
            },
          });
        }

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
        totalMemberExpressions++;

        const length = node.end - node.start;
        const path = extractMemberPath(node);
        if (path && path.length > 0) {
          memberPaths.push({
            path,
            index: node.start,
            length,
          });

          // Root segment is path[0]
          const root = path[0];
          const existing = memberRoots.get(root);
          if (!existing) {
            memberRoots.set(root, {
              count: 1,
              index: node.start,
              length,
            });
          } else {
            existing.count++;
          }

          if (
            typeof maxMemberPathSegments === 'number' &&
            maxMemberPathSegments >= 0 &&
            path.length > maxMemberPathSegments
          ) {
            issues.push({
              code: 'VAL_MEMBER_PATH_TOO_DEEP',
              rule: 'maxMemberPathSegments',
              severity: 'warning',
              message: `Member path "${path.join(
                '.',
              )}" has ${path.length} segments (limit: ${maxMemberPathSegments}).`,
              note:
                'Deep object access can make expressions fragile when data models change.',
              location: makeLocation(node.start, length),
              meta: {
                path: path.join('.'),
                segments: path.length,
                maxMemberPathSegments,
              },
            });
          }
        }

        visit(node.object, depth + 1);
        visit(node.property, depth + 1);
        return;
      }

      case 'CallExpression': {
        if (node.callee.type === 'Identifier') {
          totalHelperCalls++;
          const name = node.callee.name;
          const existing = helpers.get(name);
          if (!existing) {
            helpers.set(name, {
              count: 1,
              index: node.callee.start,
              length: node.callee.end - node.callee.start,
            });
          } else {
            existing.count++;
          }
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
        const _never: never = node;
        return _never;
      }
    }
  };

  // Walk the AST
  visit(ast, 1);

  // Post-visit checks: helpers, identifiers, member roots
  const makeSet = (values?: string[]): Set<string> | null =>
    values && values.length > 0 ? new Set(values) : null;

  const allowedHelpersSet = makeSet(allowedHelpers);
  const forbiddenHelpersSet = makeSet(forbiddenHelpers);
  const allowedIdentifiersSet = makeSet(allowedIdentifiers);
  const forbiddenIdentifiersSet = makeSet(forbiddenIdentifiers);
  const allowedMemberRootsSet = makeSet(allowedMemberRoots);
  const forbiddenMemberRootsSet = makeSet(forbiddenMemberRoots);

  // Helpers allow-list / deny-list
  if (allowedHelpersSet) {
    for (const [name, info] of helpers.entries()) {
      if (!allowedHelpersSet.has(name)) {
        issues.push({
          code: 'VAL_HELPER_NOT_ALLOWED',
          rule: 'allowedHelpers',
          severity: 'error',
          message: `Helper function "${name}" is not allowed in this expression.`,
          note:
            'Remove this helper call or configure it explicitly in the allowedHelpers list.',
          location: makeLocation(info.index, info.length),
          meta: {
            helper: name,
          },
        });
      }
    }
  }

  if (forbiddenHelpersSet) {
    for (const [name, info] of helpers.entries()) {
      if (forbiddenHelpersSet.has(name)) {
        issues.push({
          code: 'VAL_HELPER_FORBIDDEN',
          rule: 'forbiddenHelpers',
          severity: 'error',
          message: `Helper function "${name}" is forbidden in this environment.`,
          note:
            'Consider using a safer alternative or moving this logic into application code.',
          location: makeLocation(info.index, info.length),
          meta: {
            helper: name,
          },
        });
      }
    }
  }

  // Identifiers allow-list / deny-list
  if (allowedIdentifiersSet) {
    for (const [name, info] of identifiers.entries()) {
      if (!allowedIdentifiersSet.has(name)) {
        issues.push({
          code: 'VAL_IDENTIFIER_NOT_ALLOWED',
          rule: 'allowedIdentifiers',
          severity: 'error',
          message: `Identifier "${name}" is not allowed in this expression.`,
          note:
            'Check your context schema or restrict available variables in the editor.',
          location: makeLocation(info.index, info.length),
          meta: {
            identifier: name,
          },
        });
      }
    }
  }

  if (forbiddenIdentifiersSet) {
    for (const [name, info] of identifiers.entries()) {
      if (forbiddenIdentifiersSet.has(name)) {
        issues.push({
          code: 'VAL_IDENTIFIER_FORBIDDEN',
          rule: 'forbiddenIdentifiers',
          severity: 'error',
          message: `Identifier "${name}" is forbidden in this expression.`,
          location: makeLocation(info.index, info.length),
          meta: {
            identifier: name,
          },
        });
      }
    }
  }

  // Member root allow-list / deny-list
  if (allowedMemberRootsSet) {
    for (const [root, info] of memberRoots.entries()) {
      if (!allowedMemberRootsSet.has(root)) {
        issues.push({
          code: 'VAL_MEMBER_ROOT_NOT_ALLOWED',
          rule: 'allowedMemberRoots',
          severity: 'error',
          message: `Member path starting with "${root}" is not allowed.`,
          note:
            'Restrict expressions to the allowed root objects (e.g. "user", "order").',
          location: makeLocation(info.index, info.length),
          meta: {
            root,
          },
        });
      }
    }
  }

  if (forbiddenMemberRootsSet) {
    for (const [root, info] of memberRoots.entries()) {
      if (forbiddenMemberRootsSet.has(root)) {
        issues.push({
          code: 'VAL_MEMBER_ROOT_FORBIDDEN',
          rule: 'forbiddenMemberRoots',
          severity: 'error',
          message: `Member path starting with "${root}" is forbidden.`,
          location: makeLocation(info.index, info.length),
          meta: {
            root,
          },
        });
      }
    }
  }

  // Sort issues: errors first, then warnings, then info, then by location index
  const severityRank: Record<IssueSeverity, number> = {
    error: 0,
    warning: 1,
    info: 2,
  };

  issues.sort((a, b) => {
    const sa = severityRank[a.severity];
    const sb = severityRank[b.severity];
    if (sa !== sb) return sa - sb;

    const ia = a.location?.index ?? 0;
    const ib = b.location?.index ?? 0;
    if (ia !== ib) return ia - ib;

    return a.code.localeCompare(b.code);
  });

  const ok = issues.every((i) => i.severity !== 'error');

  const stats: ExpressionValidationStats = {
    nodeCount,
    maxDepth: maxDepthSeen,
    totalIdentifiers,
    totalHelperCalls,
    totalMemberExpressions,
  };

  return { ok, issues, stats };
}

/////////////////////////////
// Source-level validation //
/////////////////////////////

/**
 * Validate a *source expression* by compiling it with a SafExpr engine and
 * then running AST-level validation.
 *
 * If compilation fails and `captureCompileErrorsAsIssues` is true
 * (default), the error is returned as a validation issue instead of being
 * thrown.
 */
export function validateSourceExpression<
  Context = unknown,
  Result = unknown,
>(
  source: string,
  options: ValidateSourceExpressionOptions<Context, Result> = {},
): SourceExpressionValidationResult<Context, Result> {
  const {
    engine: providedEngine,
    engineOptions,
    captureCompileErrorsAsIssues = true,
    ...astOptions
  } = options;

  const engine = providedEngine ?? createEngine(engineOptions);

  try {
    const compiled = engine.compile<Context, Result>(source);
    const ast = compiled.ast;

    const result = validateAst(ast, {
      ...astOptions,
      source,
    });

    return {
      ...result,
      compiled,
      ast,
    };
  } catch (err) {
    if (!captureCompileErrorsAsIssues) {
      // Re-throw and let the caller decide how to handle parse/runtime errors.
      throw err;
    }

    const issues: ExpressionValidationIssue[] = [];

    if (isSafexprError(err)) {
      const e = err as SafexprError;
      const loc =
        e.index != null
          ? ({
              index: e.index,
              length: 1,
              ...(typeof source === 'string'
                ? computeLineAndColumn(source, e.index)
                : {}),
            } as DiagnosticLocation)
          : undefined;

      issues.push({
        code: e.code || 'COMPILE_ERROR',
        rule: 'compile',
        severity: 'error',
        message: e.message,
        note: e.note,
        location: loc,
        meta: {
          safexpr: true,
        },
      });
    } else {
      const message =
        err instanceof Error && typeof err.message === 'string'
          ? err.message
          : String(err);

      issues.push({
        code: 'COMPILE_ERROR',
        rule: 'compile',
        severity: 'error',
        message,
      });
    }

    const stats: ExpressionValidationStats = {
      nodeCount: 0,
      maxDepth: 0,
      totalIdentifiers: 0,
      totalHelperCalls: 0,
      totalMemberExpressions: 0,
    };

    return {
      ok: false,
      issues,
      stats,
      compiled: undefined,
      ast: undefined,
    };
  }
}

/////////////////////////////
// Helper: member paths    //
/////////////////////////////

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
  if (node.computed) return null;

  const segments: string[] = [];

  // property must be identifier
  if (node.property.type === 'Identifier') {
    segments.unshift(node.property.name);
  } else {
    return null;
  }

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

    // Any other node type (call, computed member, etc.) breaks static path.
    return null;
  }

  return null;
}
