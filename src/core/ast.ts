/**
 * SafExpr – AST core types
 *
 * This file defines the *public-ish* AST shape used internally by the parser,
 * evaluator, tooling and tests.
 *
 * Goals:
 *  - Small, predictable, JS-like expression AST.
 *  - Stable discriminated unions (node.type) for good DX and tooling support.
 *  - Optional source locations for better errors and editor integrations.
 *
 * IMPORTANT:
 *  - Tests (parser.spec.ts, evaluator.spec.ts, plugins.spec.ts, etc.)
 *    assume `node.type` exists and matches the names used below.
 *  - The root `ast` exposed from `compile()` / `engine.compile()` is always
 *    an `ExpressionNode` (no Program wrapper).
 *
 * License: Apache-2.0
 * Author:  TheSkiF4er
 */

//////////////////////
// Source locations //
//////////////////////

/**
 * Character-level offset from the start of the source string.
 *  - `offset` is 0-based.
 *  - `line` is 1-based.
 *  - `column` is 1-based.
 */
export interface Position {
  offset: number;
  line: number;
  column: number;
}

/**
 * Source location of a node.
 * Implementations are free to omit `loc` entirely for performance,
 * but when present it should be accurate enough for good diagnostics.
 */
export interface SourceLocation {
  start: Position;
  end: Position;
}

/////////////////////////
// Base node & helpers //
/////////////////////////

/**
 * All possible node type strings.
 *
 * Keep this list in sync with the interfaces below and with any places where
 * string literals are used in tests or tooling.
 */
export type NodeType =
  | 'Literal'
  | 'Identifier'
  | 'UnaryExpression'
  | 'BinaryExpression'
  | 'LogicalExpression'
  | 'NullishCoalescingExpression'
  | 'ConditionalExpression'
  | 'MemberExpression'
  | 'CallExpression'
  | 'ArrayExpression'
  | 'ObjectExpression'
  | 'Property';

/**
 * Every AST node extends this shape.
 */
export interface BaseNode {
  /**
   * Discriminant tag.
   * Tests and tools rely on this being called `type`.
   */
  type: NodeType;

  /**
   * 0-based indices into the original source string.
   *
   *  - `start` is inclusive.
   *  - `end` is exclusive.
   */
  start: number;
  end: number;

  /**
   * Optional, richer location info (line/column).
   * Implementations may omit this for performance reasons.
   */
  loc?: SourceLocation;
}

/////////////////////////
// Expression node set //
/////////////////////////

/**
 * Literal node.
 *
 * Represents:
 *  - number literals: 0, 42, 3.14, .5, 10.
 *  - string literals: "hello", 'world'
 *  - boolean literals: true, false
 *  - null literal: null
 */
export interface LiteralNode extends BaseNode {
  type: 'Literal';
  /**
   * Decoded literal value.
   *  - number for numeric literals
   *  - string for string literals
   *  - boolean for true/false
   *  - null for null
   */
  value: number | string | boolean | null;
  /**
   * Raw text as it appears in the source.
   * Example: `"hello"`, `'world'`, `3.14`, `null`.
   */
  raw: string;
}

/**
 * Identifier node (variable names, function names, etc.).
 */
export interface IdentifierNode extends BaseNode {
  type: 'Identifier';
  name: string;
}

/**
 * Unary expression node.
 *
 * Example: `-n`, `!flag`
 */
export interface UnaryExpressionNode extends BaseNode {
  type: 'UnaryExpression';
  operator: '-' | '!';
  argument: ExpressionNode;
  /**
   * Whether the operator appears before the operand.
   * Always true for our language, but included for familiarity.
   */
  prefix: true;
}

/**
 * Binary expression node.
 *
 * Represents arithmetic and comparison operators:
 *  - +, -, *, /, %
 *  - <, <=, >, >=, ==, !=
 *
 * Logical operators (&&, ||) use LogicalExpressionNode instead.
 * Nullish coalescing (??) uses NullishCoalescingExpressionNode.
 */
export interface BinaryExpressionNode extends BaseNode {
  type: 'BinaryExpression';
  operator:
    | '+'
    | '-'
    | '*'
    | '/'
    | '%'
    | '<'
    | '<='
    | '>'
    | '>='
    | '=='
    | '!=';
  left: ExpressionNode;
  right: ExpressionNode;
}

/**
 * Logical expression node for `&&` and `||`.
 *
 * Short-circuit semantics are enforced at evaluation time.
 */
export interface LogicalExpressionNode extends BaseNode {
  type: 'LogicalExpression';
  operator: '&&' | '||';
  left: ExpressionNode;
  right: ExpressionNode;
}

/**
 * Nullish coalescing expression node (`a ?? b`).
 *
 * Semantics:
 *  - If `left` is null or undefined, evaluate and return `right`.
 *  - Otherwise return `left` as-is.
 */
export interface NullishCoalescingExpressionNode extends BaseNode {
  type: 'NullishCoalescingExpression';
  operator: '??';
  left: ExpressionNode;
  right: ExpressionNode;
}

/**
 * Ternary conditional: `test ? consequent : alternate`.
 */
export interface ConditionalExpressionNode extends BaseNode {
  type: 'ConditionalExpression';
  test: ExpressionNode;
  consequent: ExpressionNode;
  alternate: ExpressionNode;
}

/**
 * Member expression: property access.
 *
 * Examples:
 *  - `user.age`       → computed = false, property = Identifier("age")
 *  - `items[0]`       → computed = true,  property = Literal(0)
 *  - `matrix[i][j]`   → nested MemberExpressions
 */
export interface MemberExpressionNode extends BaseNode {
  type: 'MemberExpression';
  object: ExpressionNode;
  property: ExpressionNode;
  /**
   * true  → bracket notation: obj[expr]
   * false → dot notation:     obj.prop
   */
  computed: boolean;
  /**
   * Reserved for future optional chaining (`obj?.foo`).
   * Currently always false / undefined.
   */
  optional?: boolean;
}

/**
 * Function / helper call: `callee(args...)`.
 *
 * Examples:
 *  - `max(a, b)`
 *  - `sum(nums)`
 *  - `engine.fn(a).value` → MemberExpression(CallExpression(...), "value")
 */
export interface CallExpressionNode extends BaseNode {
  type: 'CallExpression';
  callee: ExpressionNode;
  arguments: ExpressionNode[];
}

/**
 * Array literal.
 *
 * Example: `[1, 2, user.age]`
 */
export interface ArrayExpressionNode extends BaseNode {
  type: 'ArrayExpression';
  elements: ExpressionNode[];
}

/**
 * Object property inside an ObjectExpression.
 *
 * Example: `{ foo: 1, bar: user.age }`
 *
 * In:
 *   - `foo: 1`
 *     key  → Identifier("foo")
 *     value→ Literal(1)
 */
export interface PropertyNode extends BaseNode {
  type: 'Property';
  key: IdentifierNode | LiteralNode;
  value: ExpressionNode;
  /**
   * `{ foo }` shorthand support (if enabled by parser).
   * When true, value is typically an Identifier with the same name as the key.
   */
  shorthand?: boolean;
}

/**
 * Object literal.
 *
 * Example: `{ foo: 1, bar: user.age }`
 */
export interface ObjectExpressionNode extends BaseNode {
  type: 'ObjectExpression';
  properties: PropertyNode[];
}

/**
 * Union of all expression nodes SafExpr currently understands.
 *
 * This is the root type for `CompiledExpression.ast`.
 */
export type ExpressionNode =
  | LiteralNode
  | IdentifierNode
  | UnaryExpressionNode
  | BinaryExpressionNode
  | LogicalExpressionNode
  | NullishCoalescingExpressionNode
  | ConditionalExpressionNode
  | MemberExpressionNode
  | CallExpressionNode
  | ArrayExpressionNode
  | ObjectExpressionNode
  | PropertyNode; // Property only appears inside ObjectExpression, but is part of the AST graph

/**
 * Convenience alias used in tooling and visitors.
 */
export type AnyAstNode = ExpressionNode;

/////////////////////////////
// Type guards (utilities) //
/////////////////////////////

/**
 * Type guard helpers for ergonomic use in tests and tools.
 */

export function isLiteral(node: AnyAstNode): node is LiteralNode {
  return node.type === 'Literal';
}

export function isIdentifier(node: AnyAstNode): node is IdentifierNode {
  return node.type === 'Identifier';
}

export function isUnary(node: AnyAstNode): node is UnaryExpressionNode {
  return node.type === 'UnaryExpression';
}

export function isBinary(node: AnyAstNode): node is BinaryExpressionNode {
  return node.type === 'BinaryExpression';
}

export function isLogical(node: AnyAstNode): node is LogicalExpressionNode {
  return node.type === 'LogicalExpression';
}

export function isNullishCoalescing(
  node: AnyAstNode,
): node is NullishCoalescingExpressionNode {
  return node.type === 'NullishCoalescingExpression';
}

export function isConditional(
  node: AnyAstNode,
): node is ConditionalExpressionNode {
  return node.type === 'ConditionalExpression';
}

export function isMember(node: AnyAstNode): node is MemberExpressionNode {
  return node.type === 'MemberExpression';
}

export function isCall(node: AnyAstNode): node is CallExpressionNode {
  return node.type === 'CallExpression';
}

export function isArrayExpression(
  node: AnyAstNode,
): node is ArrayExpressionNode {
  return node.type === 'ArrayExpression';
}

export function isObjectExpression(
  node: AnyAstNode,
): node is ObjectExpressionNode {
  return node.type === 'ObjectExpression';
}

export function isProperty(node: AnyAstNode): node is PropertyNode {
  return node.type === 'Property';
}

///////////////////////////////
// Traversal / visitor utils //
///////////////////////////////

/**
 * A small visitor interface for traversing ASTs.
 *
 * You can either:
 *  - use generic hooks: `enter(node, parent)` and `leave(node, parent)`, or
 *  - use per-type hooks, e.g. `Literal?(node, parent)`, `BinaryExpression?`
 *
 * Returning `"skip"` from `enter` will skip visiting children of that node.
 * Returning `"break"` from `enter` will abort the entire traversal.
 */
export type VisitResult = void | 'skip' | 'break';

export interface Visitor {
  /**
   * Called for every node before visiting its children.
   */
  enter?(node: AnyAstNode, parent: AnyAstNode | null): VisitResult;
  /**
   * Called for every node after visiting its children.
   */
  leave?(node: AnyAstNode, parent: AnyAstNode | null): void;

  // Optional per-type hooks (only `enter`-style; `leave` remains generic).
  Literal?(node: LiteralNode, parent: AnyAstNode | null): VisitResult;
  Identifier?(node: IdentifierNode, parent: AnyAstNode | null): VisitResult;
  UnaryExpression?(
    node: UnaryExpressionNode,
    parent: AnyAstNode | null,
  ): VisitResult;
  BinaryExpression?(
    node: BinaryExpressionNode,
    parent: AnyAstNode | null,
  ): VisitResult;
  LogicalExpression?(
    node: LogicalExpressionNode,
    parent: AnyAstNode | null,
  ): VisitResult;
  NullishCoalescingExpression?(
    node: NullishCoalescingExpressionNode,
    parent: AnyAstNode | null,
  ): VisitResult;
  ConditionalExpression?(
    node: ConditionalExpressionNode,
    parent: AnyAstNode | null,
  ): VisitResult;
  MemberExpression?(
    node: MemberExpressionNode,
    parent: AnyAstNode | null,
  ): VisitResult;
  CallExpression?(
    node: CallExpressionNode,
    parent: AnyAstNode | null,
  ): VisitResult;
  ArrayExpression?(
    node: ArrayExpressionNode,
    parent: AnyAstNode | null,
  ): VisitResult;
  ObjectExpression?(
    node: ObjectExpressionNode,
    parent: AnyAstNode | null,
  ): VisitResult;
  Property?(node: PropertyNode, parent: AnyAstNode | null): VisitResult;
}

/**
 * Depth-first traversal over an AST.
 *
 * This is intentionally simple and allocation-light. It is suitable for:
 *  - analyzers / linters,
 *  - code generators,
 *  - editor tooling.
 */
export function traverse(root: AnyAstNode, visitor: Visitor): void {
  walk(root, null, visitor);
}

function walk(
  node: AnyAstNode,
  parent: AnyAstNode | null,
  visitor: Visitor,
): 'break' | void {
  const genericEnter = visitor.enter?.(node, parent);
  if (genericEnter === 'break') return 'break';
  if (genericEnter === 'skip') return;

  const specificEnter = (visitor as any)[node.type]?.(node, parent) as
    | VisitResult
    | undefined;
  if (specificEnter === 'break') return 'break';
  if (specificEnter === 'skip') return;

  // Recurse into children
  switch (node.type) {
    case 'Literal':
    case 'Identifier':
      // no children
      break;

    case 'UnaryExpression':
      if (walk(node.argument, node, visitor) === 'break') return 'break';
      break;

    case 'BinaryExpression':
    case 'LogicalExpression':
    case 'NullishCoalescingExpression':
      if (walk(node.left, node, visitor) === 'break') return 'break';
      if (walk(node.right, node, visitor) === 'break') return 'break';
      break;

    case 'ConditionalExpression':
      if (walk(node.test, node, visitor) === 'break') return 'break';
      if (walk(node.consequent, node, visitor) === 'break') return 'break';
      if (walk(node.alternate, node, visitor) === 'break') return 'break';
      break;

    case 'MemberExpression':
      if (walk(node.object, node, visitor) === 'break') return 'break';
      if (walk(node.property, node, visitor) === 'break') return 'break';
      break;

    case 'CallExpression':
      if (walk(node.callee, node, visitor) === 'break') return 'break';
      for (const arg of node.arguments) {
        if (walk(arg, node, visitor) === 'break') return 'break';
      }
      break;

    case 'ArrayExpression':
      for (const el of node.elements) {
        if (walk(el, node, visitor) === 'break') return 'break';
      }
      break;

    case 'ObjectExpression':
      for (const prop of node.properties) {
        if (walk(prop, node, visitor) === 'break') return 'break';
      }
      break;

    case 'Property':
      if (walk(node.key, node, visitor) === 'break') return 'break';
      if (walk(node.value, node, visitor) === 'break') return 'break';
      break;
  }

  visitor.leave?.(node, parent);
}
