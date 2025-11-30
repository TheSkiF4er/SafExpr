/**
 * SafExpr – Token definitions
 *
 * This module defines the *canonical* token types used across SafExpr.
 *
 * It is intended to be the single source of truth for:
 *  - token shapes (TokenType, Token)
 *  - common operator / punctuation sets
 *  - simple classification helpers
 *
 * The internal parser/tokenizer may use their own lightweight representations
 * for performance, but tests, tooling, and editor integrations should prefer
 * these exported types for stability and DX.
 *
 * License: Apache-2.0
 * Author:  TheSkiF4er
 */

/////////////////////
// Token categories //
/////////////////////

/**
 * High-level token categories produced by SafExpr’s tokenizer.
 */
export type TokenType =
  | 'eof'
  | 'identifier'
  | 'number'
  | 'string'
  | 'punct'
  | 'operator';

/**
 * Token as seen by external consumers (tools, tests, editor integrations).
 *
 * Notes:
 *  - `value` is normalized:
 *      - identifier: raw identifier text ("user", "age", "true")
 *      - number:     raw numeric text ("3.14", "10", ".5", "1e10")
 *      - string:     decoded contents (without quotes, with simple escapes)
 *      - operator:   operator text ("&&", "==", "<=", "+", "-", …)
 *      - punct:      punctuation character ("(", ")", "{", "}", ",", …)
 *      - eof:        ""
 *  - `start`/`end` are 0-based character offsets into the original source
 *    (end is exclusive).
 */
export interface Token {
  type: TokenType;
  value: string;
  start: number;
  end: number;
}

//////////////////////////////
// Canonical operator sets  //
//////////////////////////////

/**
 * All multi-character operators recognized by SafExpr.
 */
export const MULTI_CHAR_OPERATORS: readonly string[] = [
  '&&',
  '||',
  '??',
  '==',
  '!=',
  '<=',
  '>=',
] as const;

/**
 * All single-character operators recognized by SafExpr.
 */
export const SINGLE_CHAR_OPERATORS: readonly string[] = [
  '+',
  '-',
  '*',
  '/',
  '%',
  '<',
  '>',
  '!',
] as const;

/**
 * Complete set of operator lexemes.
 */
export const ALL_OPERATORS: readonly string[] = [
  ...MULTI_CHAR_OPERATORS,
  ...SINGLE_CHAR_OPERATORS,
] as const;

/**
 * Punctuation characters recognized by SafExpr.
 */
export const PUNCTUATION_CHARS: readonly string[] = [
  '(',
  ')',
  '[',
  ']',
  '{',
  '}',
  '.',
  ',',
  ':',
  '?',
] as const;

/**
 * Keywords that are parsed as literals rather than identifiers.
 */
export const KEYWORD_LITERALS: readonly string[] = [
  'true',
  'false',
  'null',
] as const;

/**
 * Identifiers that are “special” but still treated as identifiers:
 *
 *  - `undefined` is parsed as an identifier syntactically, but the evaluator
 *    interprets it as the JS `undefined` value.
 */
export const SPECIAL_IDENTIFIERS: readonly string[] = ['undefined'] as const;

/**
 * Commonly forbidden global identifiers.
 *
 * The parser/evaluator both keep their own copies (for performance / isolation),
 * but tools may rely on this set to provide warnings or hints in editors.
 */
export const FORBIDDEN_GLOBAL_IDENTIFIERS: readonly string[] = [
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
] as const;

//////////////////////////////
// Type guards & utilities  //
//////////////////////////////

export function isOperatorToken(token: Token): boolean {
  return token.type === 'operator';
}

export function isPunctToken(token: Token): boolean {
  return token.type === 'punct';
}

export function isIdentifierToken(token: Token): boolean {
  return token.type === 'identifier';
}

export function isNumberToken(token: Token): boolean {
  return token.type === 'number';
}

export function isStringToken(token: Token): boolean {
  return token.type === 'string';
}

export function isEofToken(token: Token): boolean {
  return token.type === 'eof';
}

export function isMultiCharOperator(op: string): boolean {
  return MULTI_CHAR_OPERATORS.includes(op);
}

export function isSingleCharOperator(op: string): boolean {
  return SINGLE_CHAR_OPERATORS.includes(op);
}

export function isOperatorLexeme(op: string): boolean {
  return ALL_OPERATORS.includes(op);
}

export function isPunctuationChar(ch: string): boolean {
  return PUNCTUATION_CHARS.includes(ch);
}

export function isKeywordLiteral(name: string): boolean {
  return KEYWORD_LITERALS.includes(name);
}

export function isSpecialIdentifier(name: string): boolean {
  return SPECIAL_IDENTIFIERS.includes(name);
}

export function isForbiddenGlobalIdentifier(name: string): boolean {
  return FORBIDDEN_GLOBAL_IDENTIFIERS.includes(name);
}

/**
 * Convenience function to build a token.
 *
 * Mostly useful in tests and tooling that synthesize tokens.
 */
export function createToken(
  type: TokenType,
  value: string,
  start: number,
  end: number,
): Token {
  return { type, value, start, end };
}
