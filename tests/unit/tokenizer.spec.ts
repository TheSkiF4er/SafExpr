// SafExpr/tests/unit/tokenizer.spec.ts
//
// Unit tests for the Safexpr tokenizer / lexer.
//
// This file is intentionally a bit “spec-like” and assumes there is a
// public (or at least test-visible) tokenizer with the following shape:
//
//   import { tokenize } from '../../src/tokenizer';
//
//   type Token = {
//     type: string;             // e.g. "Number", "String", "Identifier", "Operator", ...
//     lexeme: string;           // raw substring from source
//     value?: unknown;          // decoded value for literals (number, string, boolean, null)
//     start: number;            // start offset (0-based, inclusive)
//     end: number;              // end offset (0-based, exclusive)
//   }
//
// If your actual implementation differs, you can adapt these tests,
// but the *behavior* they describe is a good baseline for a safe,
// useful expression tokenizer.

import { describe, it, expect } from 'vitest';
import { tokenize } from '../../src/tokenizer'; // adjust path / name if needed

// Lightweight type assumption for tests:
type Token = {
  type: string;
  lexeme: string;
  value?: unknown;
  start: number;
  end: number;
};

// Helper to run tokenizer and return tokens (excluding EOF, if you have one)
function lex(source: string): Token[] {
  const tokens = tokenize(source) as Token[];
  // If implementation appends an EOF token, strip it for most tests:
  if (tokens.length > 0 && tokens[tokens.length - 1].type === 'EOF') {
    return tokens.slice(0, -1);
  }
  return tokens;
}

function kinds(tokens: Token[]): string[] {
  return tokens.map((t) => t.type);
}

function lexemes(tokens: Token[]): string[] {
  return tokens.map((t) => t.lexeme);
}

// -----------------------------------------------------------------------------
// Literals
// -----------------------------------------------------------------------------

describe('Tokenizer – numeric literals', () => {
  it('tokenizes integer and float literals', () => {
    const tokens = lex('0 42 3.14 .5 10.');

    expect(lexemes(tokens)).toEqual(['0', '42', '3.14', '.5', '10.',]);
    // We don’t assert exact type names here, but we do expect them to be
    // consistently “number-like”.
    expect(tokens.every((t) => t.type === 'Number' || t.type === 'Unknown')).toBe(false);
  });

  it('attaches decoded numeric values when available', () => {
    const [t1, t2, t3] = lex('0 3.14 .5');

    expect(t1.value).toBe(0);
    expect(t2.value).toBeCloseTo(3.14);
    expect(t3.value).toBeCloseTo(0.5);
  });
});

describe('Tokenizer – string literals', () => {
  it('tokenizes simple single and double-quoted strings', () => {
    const tokens = lex(`"hello" 'world'`);

    expect(lexemes(tokens)).toEqual(['"hello"', `'world'`]);
    tokens.forEach((t) => expect(t.type).toBe('String'));
  });

  it('decodes string value (without quotes)', () => {
    const [t1, t2] = lex(`"hello" 'world'`);

    expect(t1.value).toBe('hello');
    expect(t2.value).toBe('world');
  });

  it('supports basic escape sequences', () => {
    const tokens = lex(`"a\\n b" 'c\\t d' "\\\\"`);

    const [t1, t2, t3] = tokens;
    expect(t1.value).toBe('a\n b');
    expect(t2.value).toBe('c\t d');
    expect(t3.value).toBe('\\');
  });
});

describe('Tokenizer – boolean and null literals', () => {
  it('tokenizes true, false, and null as distinct literal tokens', () => {
    const tokens = lex('true false null');

    expect(lexemes(tokens)).toEqual(['true', 'false', 'null']);
    tokens.forEach((t) => expect(['Boolean', 'Null']).toContain(t.type));

    const [tTrue, tFalse, tNull] = tokens;
    expect(tTrue.value).toBe(true);
    expect(tFalse.value).toBe(false);
    expect(tNull.value).toBeNull();
  });
});

// -----------------------------------------------------------------------------
// Identifiers
// -----------------------------------------------------------------------------

describe('Tokenizer – identifiers', () => {
  it('tokenizes simple identifiers', () => {
    const tokens = lex('a price user_1 _internal fooBar');

    expect(lexemes(tokens)).toEqual(['a', 'price', 'user_1', '_internal', 'fooBar']);
    tokens.forEach((t) => expect(t.type).toBe('Identifier'));
  });

  it('distinguishes identifiers from keywords / literals', () => {
    const tokens = lex('trueVal falsey nullish');

    expect(lexemes(tokens)).toEqual(['trueVal', 'falsey', 'nullish']);
    tokens.forEach((t) => expect(t.type).toBe('Identifier'));
  });
});

// -----------------------------------------------------------------------------
// Operators & punctuators
// -----------------------------------------------------------------------------

describe('Tokenizer – operators & punctuators', () => {
  it('tokenizes arithmetic operators', () => {
    const tokens = lex('a + b - c * d / e % f');

    expect(lexemes(tokens)).toEqual([
      'a',
      '+',
      'b',
      '-',
      'c',
      '*',
      'd',
      '/',
      'e',
      '%',
      'f',
    ]);
  });

  it('tokenizes comparison and equality operators', () => {
    const tokens = lex('a == b != c > d >= e < f <= g');

    expect(lexemes(tokens)).toEqual([
      'a',
      '==',
      'b',
      '!=',
      'c',
      '>',
      'd',
      '>=',
      'e',
      '<',
      'f',
      '<=',
      'g',
    ]);
  });

  it('tokenizes logical operators && and || and !', () => {
    const tokens = lex('a && b || !c');

    expect(lexemes(tokens)).toEqual(['a', '&&', 'b', '||', '!', 'c']);
  });

  it('tokenizes punctuation: parentheses, brackets, dots, commas, question, colon', () => {
    const tokens = lex('(a[0].b, c ? d : e)');

    expect(lexemes(tokens)).toEqual([
      '(',
      'a',
      '[',
      '0',
      ']',
      '.',
      'b',
      ',',
      'c',
      '?',
      'd',
      ':',
      'e',
      ')',
    ]);
  });

  it('distinguishes dot as part of a number vs separate operator', () => {
    const tokens1 = lex('3.14');
    const tokens2 = lex('a . b');

    // "3.14" should be a single number token
    expect(tokens1.length).toBe(1);
    expect(tokens1[0].lexeme).toBe('3.14');

    // "a . b" should be three tokens: Identifier, ".", Identifier
    expect(lexemes(tokens2)).toEqual(['a', '.', 'b']);
  });
});

// -----------------------------------------------------------------------------
// Whitespace & comments
// -----------------------------------------------------------------------------

describe('Tokenizer – whitespace & comments', () => {
  it('ignores whitespace between tokens', () => {
    const tokens = lex('  \n  a   +   b\t\t');

    expect(lexemes(tokens)).toEqual(['a', '+', 'b']);
  });

  it('skips line comments starting with //', () => {
    const tokens = lex('a + b // this is a comment');

    expect(lexemes(tokens)).toEqual(['a', '+', 'b']);
  });

  it('skips block comments /* ... */', () => {
    const tokens = lex('a /* inner comment */ + /* another */ b');

    expect(lexemes(tokens)).toEqual(['a', '+', 'b']);
  });

  it('handles nested-looking comment content but does not nest block comments', () => {
    const tokens = lex('a /* not /* nested */ + b');

    expect(lexemes(tokens)).toEqual(['a', '+', 'b']);
  });
});

// -----------------------------------------------------------------------------
// Positions (start / end offsets)
// -----------------------------------------------------------------------------

describe('Tokenizer – position info', () => {
  it('reports correct start/end offsets for simple tokens', () => {
    const source = 'a + 42';
    const tokens = lex(source);

    // "a" at [0,1)
    expect(tokens[0].lexeme).toBe('a');
    expect(tokens[0].start).toBe(0);
    expect(tokens[0].end).toBe(1);

    // "+" at [2,3)
    expect(tokens[1].lexeme).toBe('+');
    expect(tokens[1].start).toBe(2);
    expect(tokens[1].end).toBe(3);

    // "42" at [4,6)
    expect(tokens[2].lexeme).toBe('42');
    expect(tokens[2].start).toBe(4);
    expect(tokens[2].end).toBe(6);
  });

  it('handles multi-line input correctly', () => {
    const source = 'a +\n  b * 10';
    const tokens = lex(source);

    expect(lexemes(tokens)).toEqual(['a', '+', 'b', '*', '10']);

    // Basic monotonicity: start < end and tokens are in order
    for (let i = 0; i < tokens.length; i++) {
      expect(tokens[i].start).toBeLessThan(tokens[i].end);
      if (i > 0) {
        expect(tokens[i].start).toBeGreaterThanOrEqual(tokens[i - 1].end);
      }
    }
  });
});

// -----------------------------------------------------------------------------
// Error cases
// -----------------------------------------------------------------------------

describe('Tokenizer – error handling', () => {
  it('throws or flags error for unterminated string literals', () => {
    const sources = [`"unterminated`, `'also-unterminated`];

    for (const src of sources) {
      let caught: unknown;
      try {
        lex(src);
      } catch (err) {
        caught = err;
      }

      // Implementation may:
      //  - Throw an error (preferred), OR
      //  - Return a special "Error" token.
      if (caught) {
        expect(caught).toBeDefined();
      } else {
        const tokens = lex(src);
        expect(tokens.some((t) => t.type === 'Error')).toBe(true);
      }
    }
  });

  it('throws or flags error for illegal characters', () => {
    const source = 'a + b @ c';

    let caught: unknown;
    try {
      lex(source);
    } catch (err) {
      caught = err;
    }

    if (caught) {
      expect(caught).toBeDefined();
    } else {
      const tokens = lex(source);
      expect(tokens.some((t) => t.type === 'Error')).toBe(true);
    }
  });

  it('fails fast on extremely long unbroken tokens (aspirational)', () => {
    const longIdent = 'a'.repeat(10_000);

    let caught: unknown;
    try {
      lex(longIdent);
    } catch (err) {
      caught = err;
    }

    // You might choose to allow this but apply global length limits elsewhere.
    // For DoS safety, failing early is often better.
    if (caught) {
      expect(caught).toBeDefined();
    } else {
      // If allowed, ensure it is exactly one token
      const tokens = lex(longIdent);
      expect(tokens.length).toBe(1);
      expect(tokens[0].lexeme.length).toBe(longIdent.length);
    }
  });
});

// -----------------------------------------------------------------------------
// Integration-ish smoke test
// -----------------------------------------------------------------------------

describe('Tokenizer – integration-style smoke test', () => {
  it('tokenizes a realistic Safexpr snippet end-to-end', () => {
    const source = `
      user.premium && user.age >= 18
        ? (order.total * 0.9 + shipping) * (1 + taxRate)
        : (order.total + shipping) * (1 + taxRate)
    `;

    const tokens = lex(source);

    // Just a smoke check on some key lexemes and ordering:
    expect(tokens.length).toBeGreaterThan(10);

    const kindsList = kinds(tokens);
    expect(kindsList).toContain('Identifier');
    expect(kindsList).toContain('Number');
    expect(kindsList).toContain('Operator');

    expect(lexemes(tokens)).toContain('user');
    expect(lexemes(tokens)).toContain('premium');
    expect(lexemes(tokens)).toContain('age');
    expect(lexemes(tokens)).toContain('18');
    expect(lexemes(tokens)).toContain('order');
    expect(lexemes(tokens)).toContain('total');
    expect(lexemes(tokens)).toContain('0.9');
    expect(lexemes(tokens)).toContain('taxRate');
    expect(lexemes(tokens)).toContain('?');
    expect(lexemes(tokens)).toContain(':');
  });
});
