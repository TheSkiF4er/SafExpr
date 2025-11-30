/**
 * SafExpr – Parser core
 *
 * This module turns a source string into an AST (`ExpressionNode`).
 *
 * Responsibilities:
 *  - Tokenize the source (whitespace, comments, literals, identifiers, operators).
 *  - Parse with correct precedence/associativity into a stable AST shape.
 *  - Enforce some safety rules early (length, depth, dangerous keys, globals).
 *  - Produce good `SafexprError` diagnostics on invalid input.
 *
 * Evaluation is handled by `evaluator.ts`.
 * Engine orchestration is handled by `engine.ts`.
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
  createParseError,
  createSecurityError,
  createDosError,
} from './errors';

import type { ParseOptions } from './engine';

/////////////////////
// Public API      //
/////////////////////

/**
 * Parse an expression string into an AST.
 *
 * This is the only entry point used by the Engine:
 *
 *   const ast = parseExpression(source, {
 *     maxExpressionLength,
 *     maxAstDepth,
 *     dangerousKeys,
 *     disallowDangerousKeys,
 *     allowUnsafeGlobalAccess,
 *   });
 */
export function parseExpression(
  source: string,
  options: ParseOptions,
): ExpressionNode {
  if (
    typeof options.maxExpressionLength === 'number' &&
    options.maxExpressionLength >= 0 &&
    source.length > options.maxExpressionLength
  ) {
    throw createDosError({
      message: 'SafExpr: maximum expression length exceeded.',
      source,
      index: options.maxExpressionLength,
      length: source.length - options.maxExpressionLength,
    });
  }

  const parser = new Parser(source, options);
  const ast = parser.parseExpressionRoot();
  return ast;
}

/////////////////////
// Tokenizer types //
/////////////////////

type TokenType = 'eof' | 'identifier' | 'number' | 'string' | 'punct' | 'operator';

interface Token {
  type: TokenType;
  value: string;
  start: number;
  end: number;
}

/////////////////////
// Parser class    //
/////////////////////

class Parser {
  private readonly src: string;
  private readonly len: number;
  private pos = 0;
  private token: Token;

  private readonly maxDepth?: number;
  private readonly dangerousKeys: string[];
  private readonly disallowDangerousKeys: boolean;
  private readonly allowUnsafeGlobalAccess: boolean;

  constructor(source: string, options: ParseOptions) {
    this.src = source;
    this.len = source.length;

    this.maxDepth =
      typeof options.maxAstDepth === 'number' && options.maxAstDepth >= 0
        ? options.maxAstDepth
        : undefined;
    this.dangerousKeys = options.dangerousKeys || [];
    this.disallowDangerousKeys = !!options.disallowDangerousKeys;
    this.allowUnsafeGlobalAccess = !!options.allowUnsafeGlobalAccess;

    this.token = {
      type: 'eof',
      value: '',
      start: 0,
      end: 0,
    };

    this.nextToken();
  }

  /////////////////////
  // Public root API //
  /////////////////////

  parseExpressionRoot(): ExpressionNode {
    const expr = this.parseExpression(1);
    this.expectEOF();
    return expr;
  }

  /////////////////////////////
  // Expression entry points //
  /////////////////////////////

  /**
   * Top-level expression parser.
   */
  private parseExpression(depth: number): ExpressionNode {
    // Depth is enforced per-layer to approximate AST nesting.
    this.ensureDepth(depth);
    return this.parseConditional(depth);
  }

  /**
   * Conditional (ternary) expression:
   *   test ? consequent : alternate
   */
  private parseConditional(depth: number): ExpressionNode {
    let expr = this.parseNullish(depth + 1);

    if (this.matchOperator('?')) {
      const start = expr.start;
      this.nextToken(); // consume '?'

      const consequent = this.parseExpression(depth + 1);
      this.expectPunct(':');
      const alternate = this.parseExpression(depth + 1);

      const node: ConditionalExpressionNode = {
        type: 'ConditionalExpression',
        test: expr,
        consequent,
        alternate,
        start,
        end: alternate.end,
      };
      return node;
    }

    return expr;
  }

  /**
   * Nullish coalescing:
   *   a ?? b ?? c
   */
  private parseNullish(depth: number): ExpressionNode {
    this.ensureDepth(depth);
    let expr = this.parseLogicalOr(depth + 1);

    while (this.matchOperator('??')) {
      const start = expr.start;
      this.nextToken(); // consume '??'
      const right = this.parseLogicalOr(depth + 1);
      const node: NullishCoalescingExpressionNode = {
        type: 'NullishCoalescingExpression',
        operator: '??',
        left: expr,
        right,
        start,
        end: right.end,
      };
      expr = node;
    }

    return expr;
  }

  /**
   * Logical OR:
   *   a || b || c
   */
  private parseLogicalOr(depth: number): ExpressionNode {
    this.ensureDepth(depth);
    let expr = this.parseLogicalAnd(depth + 1);

    while (this.matchOperator('||')) {
      const start = expr.start;
      this.nextToken(); // consume '||'
      const right = this.parseLogicalAnd(depth + 1);
      const node: LogicalExpressionNode = {
        type: 'LogicalExpression',
        operator: '||',
        left: expr,
        right,
        start,
        end: right.end,
      };
      expr = node;
    }

    return expr;
  }

  /**
   * Logical AND:
   *   a && b && c
   */
  private parseLogicalAnd(depth: number): ExpressionNode {
    this.ensureDepth(depth);
    let expr = this.parseEquality(depth + 1);

    while (this.matchOperator('&&')) {
      const start = expr.start;
      this.nextToken(); // consume '&&'
      const right = this.parseEquality(depth + 1);
      const node: LogicalExpressionNode = {
        type: 'LogicalExpression',
        operator: '&&',
        left: expr,
        right,
        start,
        end: right.end,
      };
      expr = node;
    }

    return expr;
  }

  /**
   * Equality:
   *   a == b
   *   a != b
   */
  private parseEquality(depth: number): ExpressionNode {
    this.ensureDepth(depth);
    let expr = this.parseRelational(depth + 1);

    while (this.matchOperator('==') || this.matchOperator('!=')) {
      const op = this.token.value as '==' | '!=';
      const start = expr.start;
      this.nextToken(); // consume operator
      const right = this.parseRelational(depth + 1);
      const node: BinaryExpressionNode = {
        type: 'BinaryExpression',
        operator: op,
        left: expr,
        right,
        start,
        end: right.end,
      };
      expr = node;
    }

    return expr;
  }

  /**
   * Relational:
   *   <  <=  >  >=
   */
  private parseRelational(depth: number): ExpressionNode {
    this.ensureDepth(depth);
    let expr = this.parseAdditive(depth + 1);

    while (
      this.matchOperator('<') ||
      this.matchOperator('<=') ||
      this.matchOperator('>') ||
      this.matchOperator('>=')
    ) {
      const op = this.token.value as '<' | '<=' | '>' | '>=';
      const start = expr.start;
      this.nextToken();
      const right = this.parseAdditive(depth + 1);
      const node: BinaryExpressionNode = {
        type: 'BinaryExpression',
        operator: op,
        left: expr,
        right,
        start,
        end: right.end,
      };
      expr = node;
    }

    return expr;
  }

  /**
   * Additive:
   *   +, -
   */
  private parseAdditive(depth: number): ExpressionNode {
    this.ensureDepth(depth);
    let expr = this.parseMultiplicative(depth + 1);

    while (this.matchOperator('+') || this.matchOperator('-')) {
      const op = this.token.value as '+' | '-';
      const start = expr.start;
      this.nextToken();
      const right = this.parseMultiplicative(depth + 1);
      const node: BinaryExpressionNode = {
        type: 'BinaryExpression',
        operator: op,
        left: expr,
        right,
        start,
        end: right.end,
      };
      expr = node;
    }

    return expr;
  }

  /**
   * Multiplicative:
   *   *, /, %
   */
  private parseMultiplicative(depth: number): ExpressionNode {
    this.ensureDepth(depth);
    let expr = this.parseUnary(depth + 1);

    while (
      this.matchOperator('*') ||
      this.matchOperator('/') ||
      this.matchOperator('%')
    ) {
      const op = this.token.value as '*' | '/' | '%';
      const start = expr.start;
      this.nextToken();
      const right = this.parseUnary(depth + 1);
      const node: BinaryExpressionNode = {
        type: 'BinaryExpression',
        operator: op,
        left: expr,
        right,
        start,
        end: right.end,
      };
      expr = node;
    }

    return expr;
  }

  /**
   * Unary:
   *   -expr
   *   !expr
   */
  private parseUnary(depth: number): ExpressionNode {
    this.ensureDepth(depth);

    if (this.matchOperator('-') || this.matchOperator('!')) {
      const op = this.token.value as '-' | '!';
      const start = this.token.start;
      this.nextToken();
      const argument = this.parseUnary(depth + 1);
      const node: UnaryExpressionNode = {
        type: 'UnaryExpression',
        operator: op,
        argument,
        prefix: true,
        start,
        end: argument.end,
      };
      return node;
    }

    return this.parsePostfix(depth + 1);
  }

  /**
   * Postfix: member access and function calls.
   *
   *   primary
   *   primary.prop
   *   primary["prop"]
   *   fn(arg1, arg2)
   *   foo.bar(baz)[0].qux
   */
  private parsePostfix(depth: number): ExpressionNode {
    this.ensureDepth(depth);
    let expr = this.parsePrimary(depth + 1);

    // Chain of .prop, [expr], (args)
    for (;;) {
      // Member access: obj.prop
      if (this.matchPunct('.')) {
        this.ensureDepth(depth + 1);
        this.nextToken(); // consume '.'

        if (this.token.type !== 'identifier') {
          this.unexpectedToken(
            'Expected an identifier after "." in member expression.',
          );
        }

        const name = this.token.value;
        const startProp = this.token.start;
        const endProp = this.token.end;

        if (
          this.disallowDangerousKeys &&
          this.isDangerousKeyName(name)
        ) {
          throw createSecurityError({
            message: `SafExpr: access to dangerous property "${name}" is not allowed.`,
            source: this.src,
            index: startProp,
            length: endProp - startProp,
          });
        }

        const property: IdentifierNode = {
          type: 'Identifier',
          name,
          start: startProp,
          end: endProp,
        };

        this.nextToken(); // consume identifier

        const node: MemberExpressionNode = {
          type: 'MemberExpression',
          object: expr,
          property,
          computed: false,
          optional: false,
          start: expr.start,
          end: property.end,
        };

        expr = node;
        continue;
      }

      // Computed member: obj[expr]
      if (this.matchPunct('[')) {
        this.ensureDepth(depth + 1);
        const startBracket = this.token.start;
        this.nextToken(); // consume '['

        const propertyExpr = this.parseExpression(depth + 1);
        this.expectPunct(']');

        const node: MemberExpressionNode = {
          type: 'MemberExpression',
          object: expr,
          property: propertyExpr,
          computed: true,
          optional: false,
          start: expr.start,
          end: propertyExpr.end,
        };

        expr = node;
        continue;
      }

      // Call: fn(args...)
      if (this.matchPunct('(')) {
        this.ensureDepth(depth + 1);
        const startCall = expr.start;
        this.nextToken(); // consume '('

        const args: ExpressionNode[] = [];
        if (!this.matchPunct(')')) {
          for (;;) {
            const arg = this.parseExpression(depth + 1);
            args.push(arg);
            if (this.matchPunct(',')) {
              this.nextToken();
              continue;
            }
            break;
          }
          this.expectPunct(')');
        } else {
          // empty arg list
          this.nextToken(); // consume ')'
        }

        const node: CallExpressionNode = {
          type: 'CallExpression',
          callee: expr,
          arguments: args,
          start: startCall,
          end: args.length > 0 ? args[args.length - 1].end : this.token.start,
        };

        expr = node;
        continue;
      }

      break;
    }

    return expr;
  }

  /**
   * Primary expressions:
   *   - literals
   *   - identifiers
   *   - parenthesized expression
   *   - array literal
   *   - object literal
   */
  private parsePrimary(depth: number): ExpressionNode {
    this.ensureDepth(depth);

    const tok = this.token;

    // Literals: number
    if (tok.type === 'number') {
      const node = this.buildNumericLiteral(tok);
      this.nextToken();
      return node;
    }

    // Literals: string
    if (tok.type === 'string') {
      const node = this.buildStringLiteral(tok);
      this.nextToken();
      return node;
    }

    // Identifiers / keywords
    if (tok.type === 'identifier') {
      const name = tok.value;

      if (name === 'true' || name === 'false') {
        const node: LiteralNode = {
          type: 'Literal',
          value: name === 'true',
          raw: name,
          start: tok.start,
          end: tok.end,
        };
        this.nextToken();
        return node;
      }

      if (name === 'null') {
        const node: LiteralNode = {
          type: 'Literal',
          value: null,
          raw: name,
          start: tok.start,
          end: tok.end,
        };
        this.nextToken();
        return node;
      }

      // Forbid direct access to known globals at parse-time too,
      // unless allowUnsafeGlobalAccess is true.
      if (!this.allowUnsafeGlobalAccess && isForbiddenGlobalName(name)) {
        throw createSecurityError({
          message: `SafExpr: access to global "${name}" is not allowed.`,
          source: this.src,
          index: tok.start,
          length: tok.end - tok.start,
        });
      }

      const node: IdentifierNode = {
        type: 'Identifier',
        name,
        start: tok.start,
        end: tok.end,
      };
      this.nextToken();
      return node;
    }

    // Parenthesized expression: (expr)
    if (this.matchPunct('(')) {
      this.nextToken();
      const expr = this.parseExpression(depth + 1);
      this.expectPunct(')');
      // We do not wrap in a "ParenthesizedExpression" node; we just return
      // the inner expression as-is. Locations are kept from the inner node.
      return expr;
    }

    // Array literal
    if (this.matchPunct('[')) {
      return this.parseArray(depth + 1);
    }

    // Object literal
    if (this.matchPunct('{')) {
      return this.parseObject(depth + 1);
    }

    this.unexpectedToken('Unexpected token in expression.');
    // unreachable, but TS wants something:
    throw new Error('SafExpr: unreachable after unexpectedToken.');
  }

  /////////////////////////
  // Array / Object      //
  /////////////////////////

  private parseArray(depth: number): ArrayExpressionNode {
    this.ensureDepth(depth);
    const start = this.token.start;
    this.nextToken(); // '['

    const elements: ExpressionNode[] = [];

    if (!this.matchPunct(']')) {
      for (;;) {
        const el = this.parseExpression(depth + 1);
        elements.push(el);

        if (this.matchPunct(',')) {
          this.nextToken();
          // allow trailing commas: [1,2,]
          if (this.matchPunct(']')) break;
          continue;
        }
        break;
      }
    }

    this.expectPunct(']');

    const end = elements.length > 0 ? elements[elements.length - 1].end : this.token.start;
    const node: ArrayExpressionNode = {
      type: 'ArrayExpression',
      elements,
      start,
      end,
    };
    return node;
  }

  private parseObject(depth: number): ObjectExpressionNode {
    this.ensureDepth(depth);
    const start = this.token.start;
    this.nextToken(); // '{'

    const properties: PropertyNode[] = [];

    if (!this.matchPunct('}')) {
      for (;;) {
        if (this.matchPunct('}')) break;

        const prop = this.parseProperty(depth + 1);
        properties.push(prop);

        if (this.matchPunct(',')) {
          this.nextToken();
          if (this.matchPunct('}')) break;
          continue;
        }
        break;
      }
    }

    this.expectPunct('}');

    const end =
      properties.length > 0
        ? properties[properties.length - 1].end
        : this.token.start;

    const node: ObjectExpressionNode = {
      type: 'ObjectExpression',
      properties,
      start,
      end,
    };
    return node;
  }

  private parseProperty(depth: number): PropertyNode {
    this.ensureDepth(depth);

    const start = this.token.start;

    // Key: identifier or literal (string/number/etc).
    let keyNode: IdentifierNode | LiteralNode;
    let shorthand = false;
    let keyString: string;

    const tok = this.token;

    if (tok.type === 'identifier') {
      // Identifier key
      keyNode = {
        type: 'Identifier',
        name: tok.value,
        start: tok.start,
        end: tok.end,
      };
      keyString = tok.value;
      this.nextToken();

      if (this.matchPunct(':')) {
        // Normal property: key: value
        this.nextToken();
      } else {
        // Shorthand: { foo } → { foo: foo }
        shorthand = true;
      }
    } else if (tok.type === 'string' || tok.type === 'number') {
      // Literal key (no shorthand)
      if (tok.type === 'string') {
        keyNode = this.buildStringLiteral(tok);
      } else {
        keyNode = this.buildNumericLiteral(tok);
      }
      keyString = String(keyNode.value);
      this.nextToken();
      this.expectPunct(':');
    } else {
      this.unexpectedToken('Expected an identifier or literal as object key.');
      // unreachable
      keyNode = {
        type: 'Literal',
        value: '',
        raw: '',
        start: tok.start,
        end: tok.end,
      };
      keyString = '';
    }

    if (
      this.disallowDangerousKeys &&
      this.isDangerousKeyName(keyString)
    ) {
      throw createSecurityError({
        message: `SafExpr: object literal uses dangerous key "${keyString}".`,
        source: this.src,
        index: start,
        length: this.token.start - start,
      });
    }

    let valueNode: ExpressionNode;

    if (shorthand) {
      // { foo } shorthand:
      //   key is Identifier("foo"), value is also an Identifier("foo")
      valueNode = {
        type: 'Identifier',
        name: (keyNode as IdentifierNode).name,
        start: keyNode.start,
        end: keyNode.end,
      };
    } else {
      valueNode = this.parseExpression(depth + 1);
    }

    const node: PropertyNode = {
      type: 'Property',
      key: keyNode,
      value: valueNode,
      shorthand: shorthand || undefined,
      start,
      end: valueNode.end,
    };

    return node;
  }

  ///////////////////////////
  // Token helpers & depth //
  ///////////////////////////

  private ensureDepth(depth: number): void {
    if (
      typeof this.maxDepth === 'number' &&
      this.maxDepth >= 0 &&
      depth > this.maxDepth
    ) {
      throw createDosError({
        message: 'SafExpr: maximum AST depth exceeded.',
        source: this.src,
        index: this.token.start,
        length: this.token.end - this.token.start,
      });
    }
  }

  private matchPunct(ch: string): boolean {
    return this.token.type === 'punct' && this.token.value === ch;
  }

  private matchOperator(op: string): boolean {
    return this.token.type === 'operator' && this.token.value === op;
  }

  private expectPunct(ch: string): void {
    if (!this.matchPunct(ch)) {
      this.unexpectedToken(`Expected "${ch}".`);
    }
    this.nextToken();
  }

  private expectEOF(): void {
    if (this.token.type !== 'eof') {
      this.unexpectedToken('Unexpected token after end of expression.');
    }
  }

  private unexpectedToken(message: string): never {
    throw createParseError({
      message,
      source: this.src,
      index: this.token.start,
      length: Math.max(1, this.token.end - this.token.start),
    });
  }

  ///////////////////
  // Tokenization  //
  ///////////////////

  private nextToken(): void {
    this.skipWhitespaceAndComments();

    if (this.pos >= this.len) {
      this.token = {
        type: 'eof',
        value: '',
        start: this.len,
        end: this.len,
      };
      return;
    }

    const start = this.pos;
    const ch = this.src.charCodeAt(this.pos);

    // Number literal: digit or "." followed by digit
    if (isDigit(ch) || (ch === 46 /* . */ && this.pos + 1 < this.len && isDigit(this.src.charCodeAt(this.pos + 1)))) {
      this.readNumberToken();
      return;
    }

    // String literal: "..." or '...'
    if (ch === 34 /* " */ || ch === 39 /* ' */) {
      this.readStringToken();
      return;
    }

    // Identifier / keyword
    if (isIdentifierStart(ch)) {
      this.readIdentifierToken();
      return;
    }

    // Multi-character operators
    const twoChars =
      this.pos + 1 < this.len
        ? this.src[this.pos] + this.src[this.pos + 1]
        : '';

    if (
      twoChars === '&&' ||
      twoChars === '||' ||
      twoChars === '??' ||
      twoChars === '==' ||
      twoChars === '!=' ||
      twoChars === '<=' ||
      twoChars === '>='
    ) {
      this.token = {
        type: 'operator',
        value: twoChars,
        start,
        end: start + 2,
      };
      this.pos += 2;
      return;
    }

    // Single-character operators
    const singleChar = this.src[this.pos];

    if ('+-*/%<>!'.includes(singleChar)) {
      this.token = {
        type: 'operator',
        value: singleChar,
        start,
        end: start + 1,
      };
      this.pos++;
      return;
    }

    // Punctuation
    if ('()[]{}.,:?'.includes(singleChar)) {
      this.token = {
        type: 'punct',
        value: singleChar,
        start,
        end: start + 1,
      };
      this.pos++;
      return;
    }

    // Unknown character
    throw createParseError({
      message: `SafExpr: unexpected character "${singleChar}".`,
      source: this.src,
      index: start,
      length: 1,
    });
  }

  private skipWhitespaceAndComments(): void {
    for (;;) {
      // Skip whitespace
      while (this.pos < this.len && isWhitespace(this.src.charCodeAt(this.pos))) {
        this.pos++;
      }

      if (this.pos >= this.len) return;

      const ch = this.src.charCodeAt(this.pos);

      // Line comment: //
      if (ch === 47 /* / */ && this.pos + 1 < this.len && this.src.charCodeAt(this.pos + 1) === 47 /* / */) {
        this.pos += 2;
        while (this.pos < this.len) {
          const c = this.src.charCodeAt(this.pos);
          if (c === 10 /* \n */ || c === 13 /* \r */) {
            this.pos++;
            break;
          }
          this.pos++;
        }
        continue;
      }

      // Block comment: /* ... */
      if (ch === 47 /* / */ && this.pos + 1 < this.len && this.src.charCodeAt(this.pos + 1) === 42 /* * */) {
        const start = this.pos;
        this.pos += 2;
        let closed = false;
        while (this.pos < this.len) {
          const c = this.src.charCodeAt(this.pos);
          if (c === 42 /* * */ && this.pos + 1 < this.len && this.src.charCodeAt(this.pos + 1) === 47 /* / */) {
            this.pos += 2;
            closed = true;
            break;
          }
          this.pos++;
        }
        if (!closed) {
          throw createParseError({
            message: 'SafExpr: unterminated block comment.',
            source: this.src,
            index: start,
            length: this.pos - start,
          });
        }
        continue;
      }

      break;
    }
  }

  private readNumberToken(): void {
    const start = this.pos;
    let ch = this.src.charCodeAt(this.pos);

    let sawDot = false;

    // Leading dot
    if (ch === 46 /* . */) {
      sawDot = true;
      this.pos++;
      if (this.pos >= this.len || !isDigit(this.src.charCodeAt(this.pos))) {
        throw createParseError({
          message: 'SafExpr: malformed number literal.',
          source: this.src,
          index: start,
          length: 1,
        });
      }
      ch = this.src.charCodeAt(this.pos);
    }

    // Digits
    while (this.pos < this.len && isDigit(this.src.charCodeAt(this.pos))) {
      this.pos++;
    }

    // Optional fractional part if we haven't yet seen a dot
    if (!sawDot && this.pos < this.len && this.src.charCodeAt(this.pos) === 46 /* . */) {
      sawDot = true;
      this.pos++;
      while (this.pos < this.len && isDigit(this.src.charCodeAt(this.pos))) {
        this.pos++;
      }
    }

    // Optional exponent part (simple support: e/E[+-]?digits)
    if (this.pos < this.len) {
      const c = this.src.charCodeAt(this.pos);
      if (c === 101 /* e */ || c === 69 /* E */) {
        let expPos = this.pos + 1;
        if (expPos < this.len) {
          const sign = this.src.charCodeAt(expPos);
          if (sign === 43 /* + */ || sign === 45 /* - */) {
            expPos++;
          }
        }
        if (expPos < this.len && isDigit(this.src.charCodeAt(expPos))) {
          this.pos = expPos + 1;
          while (this.pos < this.len && isDigit(this.src.charCodeAt(this.pos))) {
            this.pos++;
          }
        }
      }
    }

    const end = this.pos;
    const value = this.src.slice(start, end);

    this.token = {
      type: 'number',
      value,
      start,
      end,
    };
  }

  private readStringToken(): void {
    const quote = this.src.charCodeAt(this.pos); // " or '
    const start = this.pos;
    this.pos++; // skip opening quote

    let value = '';
    let closed = false;

    while (this.pos < this.len) {
      const ch = this.src.charCodeAt(this.pos);

      if (ch === quote) {
        this.pos++;
        closed = true;
        break;
      }

      if (ch === 92 /* \ */) {
        // Escape sequence
        this.pos++;
        if (this.pos >= this.len) break;
        const esc = this.src.charCodeAt(this.pos);
        this.pos++;

        switch (esc) {
          case 110 /* n */:
            value += '\n';
            break;
          case 114 /* r */:
            value += '\r';
            break;
          case 116 /* t */:
            value += '\t';
            break;
          case 92 /* \ */:
            value += '\\';
            break;
          case 34 /* " */:
            value += '"';
            break;
          case 39 /* ' */:
            value += "'";
            break;
          default:
            // Unknown escape: keep as-is
            value += String.fromCharCode(esc);
            break;
        }
      } else {
        value += String.fromCharCode(ch);
        this.pos++;
      }
    }

    if (!closed) {
      throw createParseError({
        message: 'SafExpr: unterminated string literal.',
        source: this.src,
        index: start,
        length: this.pos - start,
      });
    }

    const end = this.pos;
    const raw = this.src.slice(start, end);

    this.token = {
      type: 'string',
      value,
      start,
      end,
    };
  }

  private readIdentifierToken(): void {
    const start = this.pos;
    this.pos++; // first char already identifier-start

    while (this.pos < this.len && isIdentifierPart(this.src.charCodeAt(this.pos))) {
      this.pos++;
    }

    const end = this.pos;
    const value = this.src.slice(start, end);

    this.token = {
      type: 'identifier',
      value,
      start,
      end,
    };
  }

  //////////////////////
  // Literal builders //
  //////////////////////

  private buildNumericLiteral(tok: Token): LiteralNode {
    const num = Number(tok.value);
    if (!Number.isFinite(num)) {
      throw createParseError({
        message: `SafExpr: invalid numeric literal "${tok.value}".`,
        source: this.src,
        index: tok.start,
        length: tok.end - tok.start,
      });
    }

    const node: LiteralNode = {
      type: 'Literal',
      value: num,
      raw: tok.value,
      start: tok.start,
      end: tok.end,
    };
    return node;
  }

  private buildStringLiteral(tok: Token): LiteralNode {
    const node: LiteralNode = {
      type: 'Literal',
      value: tok.value,
      raw: this.src.slice(tok.start, tok.end),
      start: tok.start,
      end: tok.end,
    };
    return node;
  }

  ////////////////////////////
  // Dangerous key handling //
  ////////////////////////////

  private isDangerousKeyName(name: string): boolean {
    const target = name.toLowerCase();
    return this.dangerousKeys.some((k) => k.toLowerCase() === target);
  }
}

////////////////////////////
// Character classification
////////////////////////////

function isWhitespace(ch: number): boolean {
  // space, tab, LF, CR, vertical tab, form feed, non-breaking space-ish
  return (
    ch === 32 || // space
    ch === 9 || // tab
    ch === 10 || // \n
    ch === 13 || // \r
    ch === 11 || // \v
    ch === 12 || // \f
    ch === 160 // \u00A0 (NBSP – optional, but cheap)
  );
}

function isDigit(ch: number): boolean {
  return ch >= 48 && ch <= 57; // 0-9
}

function isIdentifierStart(ch: number): boolean {
  // A-Z, a-z, _, $
  return (
    (ch >= 65 && ch <= 90) || // A-Z
    (ch >= 97 && ch <= 122) || // a-z
    ch === 95 || // _
    ch === 36 // $
  );
}

function isIdentifierPart(ch: number): boolean {
  return isIdentifierStart(ch) || isDigit(ch);
}

//////////////////////////////
// Globals / security guards //
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
