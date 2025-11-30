/**
 * SafExpr – Tokenizer core
 *
 * This module turns a raw source string into a flat stream of tokens.
 *
 * It is a *standalone* tokenizer, primarily intended for:
 *  - debugging and tooling (syntax highlighters, editor integrations);
 *  - tests that want to assert on tokenization;
 *  - advanced users who want to inspect the token stream.
 *
 * The parser in `parser.ts` currently implements its own minimal tokenizer
 * internally; this module mirrors that behavior but exposes a public API.
 *
 * Token categories:
 *  - "identifier" – variable names, helper names, keywords (true/false/null)
 *  - "number"     – numeric literals (integer/float, optional exponent)
 *  - "string"     – string literals ("", '')
 *  - "operator"   – &&, ||, ??, ==, !=, <, <=, >, >=, +, -, *, /, %, !
 *  - "punct"      – ()[]{}.,:?
 *  - "eof"        – artificial end-of-file marker
 *
 * Comments:
 *  - Line comments:   // ...
 *  - Block comments:  /* ... *\/  (non-nested, must be closed)
 *
 * License: Apache-2.0
 * Author:  TheSkiF4er
 */

import { createParseError } from './errors';

/////////////////////
// Public types    //
/////////////////////

export type TokenType =
  | 'eof'
  | 'identifier'
  | 'number'
  | 'string'
  | 'punct'
  | 'operator';

export interface Token {
  /**
   * Token category (identifier, number, string, operator, punct, eof).
   */
  type: TokenType;

  /**
   * Token *value* in a normalized form:
   *  - identifier: raw identifier text (e.g. "user", "age", "true")
   *  - number:     raw numeric text (e.g. "3.14", "10", ".5")
   *  - string:     decoded string contents (without quotes)
   *  - operator:   the operator text ("&&", "==", "<=", "+", "-", …)
   *  - punct:      punctuation character ("(", ")", "{", "}", ",", …)
   *  - eof:        always empty string ""
   */
  value: string;

  /**
   * 0-based start index in the original source (inclusive).
   */
  start: number;

  /**
   * 0-based end index in the original source (exclusive).
   */
  end: number;
}

/**
 * Result of tokenization.
 */
export interface TokenStream {
  source: string;
  tokens: Token[];
}

/////////////////////
// Public API      //
/////////////////////

/**
 * Tokenize an expression source into a flat list of tokens.
 *
 * The returned list always ends with a single EOF token.
 *
 * Throws:
 *  - SafexprError (parse) on invalid or unterminated literals/comments.
 */
export function tokenize(source: string): TokenStream {
  const tokenizer = new Tokenizer(source);
  const tokens: Token[] = [];

  for (;;) {
    const tok = tokenizer.next();
    tokens.push(tok);
    if (tok.type === 'eof') break;
  }

  return { source, tokens };
}

/////////////////////
// Implementation  //
/////////////////////

class Tokenizer {
  private readonly src: string;
  private readonly len: number;
  private pos = 0;

  constructor(source: string) {
    this.src = source;
    this.len = source.length;
  }

  /**
   * Read the next token (or EOF).
   */
  next(): Token {
    this.skipWhitespaceAndComments();

    if (this.pos >= this.len) {
      return {
        type: 'eof',
        value: '',
        start: this.len,
        end: this.len,
      };
    }

    const start = this.pos;
    const ch = this.src.charCodeAt(this.pos);

    // Number: digit or "." followed by digit
    if (
      isDigit(ch) ||
      (ch === 46 /* . */ &&
        this.pos + 1 < this.len &&
        isDigit(this.src.charCodeAt(this.pos + 1)))
    ) {
      return this.readNumberToken();
    }

    // String: "..." or '...'
    if (ch === 34 /* " */ || ch === 39 /* ' */) {
      return this.readStringToken();
    }

    // Identifier
    if (isIdentifierStart(ch)) {
      return this.readIdentifierToken();
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
      this.pos += 2;
      return {
        type: 'operator',
        value: twoChars,
        start,
        end: start + 2,
      };
    }

    // Single-character operators
    const singleChar = this.src[this.pos];

    if ('+-*/%<>!'.includes(singleChar)) {
      this.pos++;
      return {
        type: 'operator',
        value: singleChar,
        start,
        end: start + 1,
      };
    }

    // Punctuation
    if ('()[]{}.,:?'.includes(singleChar)) {
      this.pos++;
      return {
        type: 'punct',
        value: singleChar,
        start,
        end: start + 1,
      };
    }

    // Unknown character
    throw createParseError({
      message: `SafExpr: unexpected character "${singleChar}".`,
      source: this.src,
      index: start,
      length: 1,
    });
  }

  ////////////////////////////
  // Whitespace & comments  //
  ////////////////////////////

  private skipWhitespaceAndComments(): void {
    for (;;) {
      // Skip whitespace
      while (
        this.pos < this.len &&
        isWhitespace(this.src.charCodeAt(this.pos))
      ) {
        this.pos++;
      }

      if (this.pos >= this.len) return;

      const ch = this.src.charCodeAt(this.pos);

      // Line comment: //
      if (
        ch === 47 /* / */ &&
        this.pos + 1 < this.len &&
        this.src.charCodeAt(this.pos + 1) === 47 /* / */
      ) {
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
      if (
        ch === 47 /* / */ &&
        this.pos + 1 < this.len &&
        this.src.charCodeAt(this.pos + 1) === 42 /* * */
      ) {
        const start = this.pos;
        this.pos += 2;
        let closed = false;
        while (this.pos < this.len) {
          const c = this.src.charCodeAt(this.pos);
          if (
            c === 42 /* * */ &&
            this.pos + 1 < this.len &&
            this.src.charCodeAt(this.pos + 1) === 47 /* / */
          ) {
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

  ///////////////////////
  // Token readers     //
  ///////////////////////

  private readNumberToken(): Token {
    const start = this.pos;
    let ch = this.src.charCodeAt(this.pos);

    let sawDot = false;

    // Leading dot
    if (ch === 46 /* . */) {
      sawDot = true;
      this.pos++;
      if (
        this.pos >= this.len ||
        !isDigit(this.src.charCodeAt(this.pos))
      ) {
        throw createParseError({
          message: 'SafExpr: malformed number literal.',
          source: this.src,
          index: start,
          length: 1,
        });
      }
      ch = this.src.charCodeAt(this.pos);
    }

    // Integral part
    while (this.pos < this.len && isDigit(this.src.charCodeAt(this.pos))) {
      this.pos++;
    }

    // Fractional part
    if (
      !sawDot &&
      this.pos < this.len &&
      this.src.charCodeAt(this.pos) === 46 /* . */
    ) {
      sawDot = true;
      this.pos++;
      while (this.pos < this.len && isDigit(this.src.charCodeAt(this.pos))) {
        this.pos++;
      }
    }

    // Exponent (simple support: e/E[+-]?digits)
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
          while (
            this.pos < this.len &&
            isDigit(this.src.charCodeAt(this.pos))
          ) {
            this.pos++;
          }
        } else {
          // We allow "1e" / "1e+" to fall through as malformed; the parser
          // or later stages may choose to reject. Here we just stop.
          this.pos = expPos;
        }
      }
    }

    const end = this.pos;
    const value = this.src.slice(start, end);

    return {
      type: 'number',
      value,
      start,
      end,
    };
  }

  private readStringToken(): Token {
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
            // Unknown escape – keep escaped char as-is.
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

    return {
      type: 'string',
      value,
      start,
      end,
    };
  }

  private readIdentifierToken(): Token {
    const start = this.pos;
    this.pos++; // first char is already identifier-start

    while (
      this.pos < this.len &&
      isIdentifierPart(this.src.charCodeAt(this.pos))
    ) {
      this.pos++;
    }

    const end = this.pos;
    const value = this.src.slice(start, end);

    return {
      type: 'identifier',
      value,
      start,
      end,
    };
  }
}

////////////////////////////
// Character classification
////////////////////////////

function isWhitespace(ch: number): boolean {
  // space, tab, LF, CR, vertical tab, form feed, NBSP
  return (
    ch === 32 || // space
    ch === 9 || // tab
    ch === 10 || // \n
    ch === 13 || // \r
    ch === 11 || // \v
    ch === 12 || // \f
    ch === 160 // \u00A0 NBSP (optional but cheap)
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
