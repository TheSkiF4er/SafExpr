/**
 * SafExpr – Evaluator core
 *
 * This module implements evaluation of SafExpr AST nodes against a context
 * object and a registry of trusted helper functions.
 *
 * Goals:
 *  - Safe evaluation of untrusted expressions.
 *  - Clear separation between *untrusted expressions* and *trusted helpers*.
 *  - Optional DoS protections via `maxEvalOperations`.
 *  - Enforcement of security rules (dangerous keys, globals).
 *
 * Parsing lives in `parser.ts`. Engine orchestration lives in `engine.ts`.
 *
 * License: Apache-2.0
 * Author:  TheSkiF4er
 */

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
} from './ast';

import {
  createRuntimeError,
  createSecurityError,
  createDosError,
  isSafexprError,
} from './errors';

import type { EvalOptions, FunctionRegistry } from './engine';

/////////////////////
// Public API      //
/////////////////////

/**
 * Evaluate a parsed SafExpr expression against a context.
 *
 * This is not meant to be used directly in most applications; the recommended
 * entry point is via:
 *
 *   const engine = createEngine(/* options *\/);
 *   const compiled = engine.compile<Ctx, Result>(source);
 *   const value = compiled.eval(ctx);
 */
export function evaluateExpression<Context, Result = unknown>(
  ast: ExpressionNode,
  context: Context,
  options: EvalOptions,
): Result {
  const state: EvalState = {
    ops: 0,
  };

  const value = evalNode(ast, context as unknown as EvalScope, options, state);
  return value as Result;
}

/////////////////////
// Internal types  //
/////////////////////

type EvalScope = unknown;

interface EvalState {
  ops: number;
}

///////////////////////////
// Evaluation dispatcher //
///////////////////////////

function evalNode(
  node: ExpressionNode,
  scope: EvalScope,
  options: EvalOptions,
  state: EvalState,
): any {
  bumpOps(node, options, state);

  switch (node.type) {
    case 'Literal':
      return evalLiteral(node as LiteralNode);

    case 'Identifier':
      return evalIdentifier(node as IdentifierNode, scope, options);

    case 'UnaryExpression':
      return evalUnary(node as UnaryExpressionNode, scope, options, state);

    case 'BinaryExpression':
      return evalBinary(node as BinaryExpressionNode, scope, options, state);

    case 'LogicalExpression':
      return evalLogical(node as LogicalExpressionNode, scope, options, state);

    case 'NullishCoalescingExpression':
      return evalNullish(
        node as NullishCoalescingExpressionNode,
        scope,
        options,
        state,
      );

    case 'ConditionalExpression':
      return evalConditional(
        node as ConditionalExpressionNode,
        scope,
        options,
        state,
      );

    case 'MemberExpression':
      return evalMember(node as MemberExpressionNode, scope, options, state);

    case 'CallExpression':
      return evalCall(node as CallExpressionNode, scope, options, state);

    case 'ArrayExpression':
      return evalArray(node as ArrayExpressionNode, scope, options, state);

    case 'ObjectExpression':
      return evalObject(node as ObjectExpressionNode, scope, options, state);

    case 'Property':
      // Properties are never evaluated directly at top level; they are handled
      // inside ObjectExpression. If we ever reach here, treat it as internal.
      return evalProperty(node as PropertyNode, scope, options, state);

    default: {
      // Exhaustiveness guard
      const _exhaustive: never = node;
      throw createRuntimeError({
        message: 'SafExpr: unsupported AST node type at evaluation time.',
        index: node.start,
      });
    }
  }
}

///////////////////////
// Operation counter //
///////////////////////

function bumpOps(
  node: ExpressionNode,
  options: EvalOptions,
  state: EvalState,
): void {
  state.ops++;
  const limit = options.maxEvalOperations;
  if (typeof limit === 'number' && limit >= 0 && state.ops > limit) {
    throw createDosError({
      message: 'SafExpr: maximum evaluation operations exceeded.',
      index: node.start,
    });
  }
}

///////////////////////
// Literal & ident   //
///////////////////////

function evalLiteral(node: LiteralNode): any {
  return node.value;
}

/**
 * Resolve bare identifiers.
 *
 * Rules:
 *  - "undefined" yields `undefined`.
 *  - Known forbidden globals (process, globalThis, window, etc.) are blocked,
 *    unless `allowUnsafeGlobalAccess` is true.
 *  - For everything else, we read from the root context (scope) as a plain
 *    property, if present; otherwise `undefined`.
 *
 * Note:
 *  - Helper functions registered via `withFunction` are *not* exposed as
 *    identifier values; they can only be used via CallExpression callee
 *    identifiers.
 */
function evalIdentifier(
  node: IdentifierNode,
  scope: EvalScope,
  options: EvalOptions,
): any {
  const name = node.name;

  if (name === 'undefined') {
    return undefined;
  }

  if (!options.allowUnsafeGlobalAccess && isForbiddenGlobalName(name)) {
    throw createSecurityError({
      message: `SafExpr: access to global "${name}" is not allowed.`,
      index: node.start,
    });
  }

  const ctx = scope as any;

  if (ctx != null && Object.prototype.hasOwnProperty.call(ctx, name)) {
    return ctx[name];
  }

  // If not found in context, we return undefined rather than throwing.
  // This makes it easier to write expressions like `user?.field ?? null`
  // (or the equivalent with ternaries).
  return undefined;
}

///////////////////////
// Unary / Binary    //
///////////////////////

function evalUnary(
  node: UnaryExpressionNode,
  scope: EvalScope,
  options: EvalOptions,
  state: EvalState,
): any {
  const arg = evalNode(node.argument, scope, options, state);

  switch (node.operator) {
    case '-': {
      const n = toNumber(arg, node.argument);
      return -n;
    }
    case '!': {
      return !toBoolean(arg);
    }
  }
}

function evalBinary(
  node: BinaryExpressionNode,
  scope: EvalScope,
  options: EvalOptions,
  state: EvalState,
): any {
  const left = evalNode(node.left, scope, options, state);
  const right = evalNode(node.right, scope, options, state);

  switch (node.operator) {
    case '+': {
      const a = toNumber(left, node.left);
      const b = toNumber(right, node.right);
      return a + b;
    }
    case '-': {
      const a = toNumber(left, node.left);
      const b = toNumber(right, node.right);
      return a - b;
    }
    case '*': {
      const a = toNumber(left, node.left);
      const b = toNumber(right, node.right);
      return a * b;
    }
    case '/': {
      const a = toNumber(left, node.left);
      const b = toNumber(right, node.right);
      if (b === 0) {
        throw createRuntimeError({
          message: 'SafExpr: division by zero.',
          index: node.right.start,
        });
      }
      return a / b;
    }
    case '%': {
      const a = toNumber(left, node.left);
      const b = toNumber(right, node.right);
      if (b === 0) {
        throw createRuntimeError({
          message: 'SafExpr: modulo by zero.',
          index: node.right.start,
        });
      }
      return a % b;
    }

    case '<':
      return (left as any) < (right as any);
    case '<=':
      return (left as any) <= (right as any);
    case '>':
      return (left as any) > (right as any);
    case '>=':
      return (left as any) >= (right as any);

    case '==':
      // We intentionally use JS "abstract equality" here, as the expression
      // language only exposes == / !=, not === / !==. If you need stricter
      // semantics, implement them in helpers.
      // eslint-disable-next-line eqeqeq
      return (left as any) == (right as any);
    case '!=':
      // eslint-disable-next-line eqeqeq
      return (left as any) != (right as any);
  }
}

function evalLogical(
  node: LogicalExpressionNode,
  scope: EvalScope,
  options: EvalOptions,
  state: EvalState,
): any {
  if (node.operator === '&&') {
    const left = evalNode(node.left, scope, options, state);
    if (!toBoolean(left)) {
      // Short-circuit – return left as in JS
      return left;
    }
    return evalNode(node.right, scope, options, state);
  }

  // '||'
  const left = evalNode(node.left, scope, options, state);
  if (toBoolean(left)) {
    return left;
  }
  return evalNode(node.right, scope, options, state);
}

function evalNullish(
  node: NullishCoalescingExpressionNode,
  scope: EvalScope,
  options: EvalOptions,
  state: EvalState,
): any {
  const left = evalNode(node.left, scope, options, state);
  if (left === null || left === undefined) {
    return evalNode(node.right, scope, options, state);
  }
  return left;
}

function evalConditional(
  node: ConditionalExpressionNode,
  scope: EvalScope,
  options: EvalOptions,
  state: EvalState,
): any {
  const test = evalNode(node.test, scope, options, state);
  if (toBoolean(test)) {
    return evalNode(node.consequent, scope, options, state);
  }
  return evalNode(node.alternate, scope, options, state);
}

////////////////////////
// Member expressions //
////////////////////////

function evalMember(
  node: MemberExpressionNode,
  scope: EvalScope,
  options: EvalOptions,
  state: EvalState,
): any {
  const object = evalNode(node.object, scope, options, state);

  if (object === null || object === undefined) {
    throw createRuntimeError({
      message: 'SafExpr: cannot read property of null or undefined.',
      index: node.object.start,
    });
  }

  let key: any;

  if (node.computed) {
    const prop = evalNode(node.property, scope, options, state);
    key = toPropertyKey(prop);
  } else {
    const propNode = node.property;
    if (propNode.type !== 'Identifier') {
      throw createRuntimeError({
        message: 'SafExpr: non-identifier property in non-computed member.',
        index: propNode.start,
      });
    }
    key = propNode.name;
  }

  if (
    options.disallowDangerousKeys &&
    typeof key === 'string' &&
    isDangerousKey(key, options.dangerousKeys)
  ) {
    throw createSecurityError({
      message: `SafExpr: access to dangerous property "${key}" is not allowed.`,
      index: node.property.start,
    });
  }

  return (object as any)[key];
}

////////////////////////
// Call expressions   //
////////////////////////

function evalCall(
  node: CallExpressionNode,
  scope: EvalScope,
  options: EvalOptions,
  state: EvalState,
): any {
  const calleeNode = node.callee;

  if (calleeNode.type !== 'Identifier') {
    // Disallow calling arbitrary values (e.g. context functions) to keep the
    // surface small and predictable. Only helpers registered via withFunction
    // are callable.
    throw createRuntimeError({
      message:
        'SafExpr: only calls to named helper functions are allowed (callee must be an identifier).',
      index: calleeNode.start,
    });
  }

  const fnName = calleeNode.name;

  if (!options.allowUnsafeGlobalAccess && isForbiddenGlobalName(fnName)) {
    throw createSecurityError({
      message: `SafExpr: calling global "${fnName}" is not allowed.`,
      index: calleeNode.start,
    });
  }

  const registry = options.functions as FunctionRegistry;
  const helper = registry[fnName];

  if (typeof helper !== 'function') {
    throw createRuntimeError({
      message: `SafExpr: unknown helper function "${fnName}".`,
      index: calleeNode.start,
    });
  }

  const args = node.arguments.map((arg) =>
    evalNode(arg, scope, options, state),
  );

  try {
    return helper(...args);
  } catch (err) {
    // If helper already threw a SafexprError, propagate as-is.
    if (isSafexprError(err)) {
      throw err;
    }
    const msg =
      err instanceof Error && typeof err.message === 'string'
        ? err.message
        : String(err);
    throw createRuntimeError({
      message: `SafExpr: error in helper "${fnName}": ${msg}`,
      index: node.start,
      cause: err,
    });
  }
}

///////////////////////////
// Array / Object / Prop //
///////////////////////////

function evalArray(
  node: ArrayExpressionNode,
  scope: EvalScope,
  options: EvalOptions,
  state: EvalState,
): any[] {
  const result: any[] = [];

  for (const el of node.elements) {
    result.push(evalNode(el, scope, options, state));
  }

  return result;
}

function evalObject(
  node: ObjectExpressionNode,
  scope: EvalScope,
  options: EvalOptions,
  state: EvalState,
): Record<string, any> {
  // Create a normal object; we rely on dangerous key checks to avoid prototype
  // pollution (e.g. "__proto__", "constructor", "prototype").
  const obj: Record<string, any> = {};

  for (const prop of node.properties) {
    const { key, value } = evalProperty(prop, scope, options, state);

    if (
      options.disallowDangerousKeys &&
      typeof key === 'string' &&
      isDangerousKey(key, options.dangerousKeys)
    ) {
      throw createSecurityError({
        message: `SafExpr: object literal uses dangerous key "${key}".`,
        index: prop.start,
      });
    }

    obj[key] = value;
  }

  return obj;
}

function evalProperty(
  node: PropertyNode,
  scope: EvalScope,
  options: EvalOptions,
  state: EvalState,
): { key: string; value: any } {
  // Count this node as an operation
  bumpOps(node, options, state);

  let key: string;

  if (node.key.type === 'Identifier') {
    key = node.key.name;
  } else {
    // Literal key (string, number, boolean, null)
    // Convert to string similarly to JS object property rules.
    key = String(node.key.value);
  }

  const value = evalNode(node.value, scope, options, state);

  return { key, value };
}

////////////////////////////
// Helpers: coercion etc. //
////////////////////////////

function toBoolean(value: any): boolean {
  return !!value;
}

function toNumber(value: any, node: ExpressionNode): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value === null) return 0;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (!Number.isNaN(n)) return n;
  }

  throw createRuntimeError({
    message: `SafExpr: expected a numeric value, got ${typeof value}.`,
    index: node.start,
  });
}

function toPropertyKey(value: any): string | number | symbol {
  // For arrays and objects we mostly care about string / number keys.
  if (typeof value === 'string' || typeof value === 'number') {
    return value;
  }
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }
  if (value === null || value === undefined) {
    return String(value);
  }
  // Fallback to string for other values.
  return String(value);
}

//////////////////////////////
// Helpers: security checks //
//////////////////////////////

const FORBIDDEN_GLOBALS = new Set<string>([
  'global',
  'globalThis',
  'window',
  'self',
  'process',
  'require',
  'module',
  'document',
  '__dirname',
  '__filename',
  'Function',
  'eval',
  'this',
]);

function isForbiddenGlobalName(name: string): boolean {
  return FORBIDDEN_GLOBALS.has(name);
}

function isDangerousKey(key: string, configured: string[]): boolean {
  if (configured.includes(key)) return true;
  // extra safety: treat lowercased variants too
  const lower = key.toLowerCase();
  return configured.some((d) => d.toLowerCase() === lower);
}
