// SafExpr/tests/unit/parser.spec.ts
//
// Unit tests for the Safexpr parser.
//
// Focus areas:
//  - AST shape for literals, identifiers, binary expressions, member access, calls, ternaries.
//  - Operator precedence and associativity.
//  - Location / position information on nodes (where available).
//  - Parse-time error reporting (column, snippet).
//
// NOTE: These tests are partly *spec-like* and rely on the convention that
// `compile()` returns an object:
//
//   { eval(context), ast, source }
//
// where `ast` is an internal AST node structure with at least:
//   - `type: string`
//   - optional `start`, `end`, `loc` info (if implemented)
//
// If your implementation exposes a different shape, you can adapt the tests
// accordingly, but the *intent* should remain similar.

import { describe, it, expect } from 'vitest';
import { compile, SafexprError } from '../../src';

// -----------------------------------------------------------------------------
// Helpers & lightweight typings (AST-ish)
// -----------------------------------------------------------------------------

type AnyAstNode = {
  type: string;
  [key: string]: unknown;
};

type LiteralNode = AnyAstNode & {
  type: 'Literal';
  value: unknown;
};

type IdentifierNode = AnyAstNode & {
  type: 'Identifier';
  name: string;
};

type BinaryExpressionNode = AnyAstNode & {
  type: 'BinaryExpression';
  operator: string;
  left: AnyAstNode;
  right: AnyAstNode;
};

type MemberExpressionNode = AnyAstNode & {
  type: 'MemberExpression';
  object: AnyAstNode;
  property: AnyAstNode;
  computed: boolean;
};

type CallExpressionNode = AnyAstNode & {
  type: 'CallExpression';
  callee: AnyAstNode;
  arguments: AnyAstNode[];
};

type ConditionalExpressionNode = AnyAstNode & {
  type: 'ConditionalExpression';
  test: AnyAstNode;
  consequent: AnyAstNode;
  alternate: AnyAstNode;
};

// Simple helper that just extracts `ast` from compile()
function parse(expression: string): AnyAstNode {
  const compiled = compile<Record<string, unknown>, unknown>(expression);
  const ast = (compiled as any).ast as AnyAstNode | undefined;

  expect(ast, 'compiled.ast should be present').toBeDefined();
  return ast!;
}

function isLiteral(node: AnyAstNode): node is LiteralNode {
  return node.type === 'Literal';
}

function isIdentifier(node: AnyAstNode): node is IdentifierNode {
  return node.type === 'Identifier';
}

function isBinary(node: AnyAstNode): node is BinaryExpressionNode {
  return node.type === 'BinaryExpression';
}

function isMember(node: AnyAstNode): node is MemberExpressionNode {
  return node.type === 'MemberExpression';
}

function isCall(node: AnyAstNode): node is CallExpressionNode {
  return node.type === 'CallExpression';
}

function isConditional(node: AnyAstNode): node is ConditionalExpressionNode {
  return node.type === 'ConditionalExpression';
}

// -----------------------------------------------------------------------------
// Literals & identifiers
// -----------------------------------------------------------------------------

describe('Parser – literals & identifiers', () => {
  it('parses numeric literals', () => {
    const ast = parse('42');
    expect(isLiteral(ast)).toBe(true);
    if (isLiteral(ast)) {
      expect(ast.value).toBe(42);
    }

    const astFloat = parse('3.14');
    expect(isLiteral(astFloat)).toBe(true);
    if (isLiteral(astFloat)) {
      expect(astFloat.value).toBe(3.14);
    }
  });

  it('parses string literals (single and double quotes)', () => {
    const ast1 = parse(`"hello"`);
    expect(isLiteral(ast1)).toBe(true);
    if (isLiteral(ast1)) {
      expect(ast1.value).toBe('hello');
    }

    const ast2 = parse(`'world'`);
    expect(isLiteral(ast2)).toBe(true);
    if (isLiteral(ast2)) {
      expect(ast2.value).toBe('world');
    }
  });

  it('parses bare identifiers', () => {
    const ast = parse('foo');
    expect(isIdentifier(ast)).toBe(true);
    if (isIdentifier(ast)) {
      expect(ast.name).toBe('foo');
    }
  });
});

// -----------------------------------------------------------------------------
// Binary expressions & precedence
// -----------------------------------------------------------------------------

describe('Parser – binary expressions & precedence', () => {
  it('parses a simple binary expression "a + b"', () => {
    const ast = parse('a + b');
    expect(isBinary(ast)).toBe(true);

    if (isBinary(ast)) {
      expect(ast.operator).toBe('+');
      expect(isIdentifier(ast.left)).toBe(true);
      expect(isIdentifier(ast.right)).toBe(true);

      if (isIdentifier(ast.left)) {
        expect(ast.left.name).toBe('a');
      }
      if (isIdentifier(ast.right)) {
        expect(ast.right.name).toBe('b');
      }
    }
  });

  it('respects multiplication precedence in "1 + 2 * 3"', () => {
    const ast = parse('1 + 2 * 3');
    expect(isBinary(ast)).toBe(true);

    if (isBinary(ast)) {
      // (1) + (2 * 3)
      expect(ast.operator).toBe('+');

      // left: 1
      expect(isLiteral(ast.left)).toBe(true);
      if (isLiteral(ast.left)) {
        expect(ast.left.value).toBe(1);
      }

      // right: 2 * 3
      expect(isBinary(ast.right)).toBe(true);
      const right = ast.right as BinaryExpressionNode;
      expect(right.operator).toBe('*');
      expect(isLiteral(right.left)).toBe(true);
      expect(isLiteral(right.right)).toBe(true);
    }
  });

  it('parses parentheses correctly: "(1 + 2) * 3"', () => {
    const ast = parse('(1 + 2) * 3');
    expect(isBinary(ast)).toBe(true);

    if (isBinary(ast)) {
      // root: *
      expect(ast.operator).toBe('*');

      // left: (1 + 2)
      expect(isBinary(ast.left)).toBe(true);
      const left = ast.left as BinaryExpressionNode;
      expect(left.operator).toBe('+');

      // right: 3
      expect(isLiteral(ast.right)).toBe(true);
      if (isLiteral(ast.right)) {
        expect(ast.right.value).toBe(3);
      }
    }
  });

  it('parses chained arithmetic with left-associativity', () => {
    const ast = parse('1 - 2 - 3');
    expect(isBinary(ast)).toBe(true);

    if (isBinary(ast)) {
      // (1 - 2) - 3
      expect(ast.operator).toBe('-');

      const left = ast.left as BinaryExpressionNode;
      expect(isBinary(left)).toBe(true);
      expect(left.operator).toBe('-');

      const right = ast.right;
      expect(isLiteral(right)).toBe(true);
      if (isLiteral(right)) {
        expect(right.value).toBe(3);
      }
    }
  });
});

// -----------------------------------------------------------------------------
// Logical operators & precedence
// -----------------------------------------------------------------------------

describe('Parser – logical expressions & precedence', () => {
  it('parses simple logical AND and OR', () => {
    const ast = parse('a && b');
    expect(isBinary(ast)).toBe(true);
    if (isBinary(ast)) {
      expect(ast.operator).toBe('&&');
    }

    const ast2 = parse('a || b');
    expect(isBinary(ast2)).toBe(true);
    if (isBinary(ast2)) {
      expect(ast2.operator).toBe('||');
    }
  });

  it('makes && bind more tightly than || in "a || b && c"', () => {
    const ast = parse('a || b && c');
    expect(isBinary(ast)).toBe(true);

    if (isBinary(ast)) {
      // root: ||
      expect(ast.operator).toBe('||');

      // left: a
      expect(isIdentifier(ast.left)).toBe(true);
      if (isIdentifier(ast.left)) {
        expect(ast.left.name).toBe('a');
      }

      // right: (b && c)
      expect(isBinary(ast.right)).toBe(true);
      const right = ast.right as BinaryExpressionNode;
      expect(right.operator).toBe('&&');
    }
  });
});

// -----------------------------------------------------------------------------
// Member access & calls
// -----------------------------------------------------------------------------

describe('Parser – member access & call expressions', () => {
  it('parses simple member access "user.age"', () => {
    const ast = parse('user.age');
    expect(isMember(ast)).toBe(true);

    if (isMember(ast)) {
      expect(isIdentifier(ast.object)).toBe(true);
      expect(isIdentifier(ast.property)).toBe(true);
      expect(ast.computed).toBe(false);

      if (isIdentifier(ast.object)) {
        expect(ast.object.name).toBe('user');
      }
      if (isIdentifier(ast.property)) {
        expect(ast.property.name).toBe('age');
      }
    }
  });

  it('parses computed member access "items[0]"', () => {
    const ast = parse('items[0]');
    expect(isMember(ast)).toBe(true);

    if (isMember(ast)) {
      expect(ast.computed).toBe(true);
      expect(isIdentifier(ast.object)).toBe(true);
      expect(isLiteral(ast.property)).toBe(true);

      if (isIdentifier(ast.object)) {
        expect(ast.object.name).toBe('items');
      }
      if (isLiteral(ast.property)) {
        expect(ast.property.value).toBe(0);
      }
    }
  });

  it('parses function calls "max(a, b)"', () => {
    const ast = parse('max(a, b)');
    expect(isCall(ast)).toBe(true);

    if (isCall(ast)) {
      expect(isIdentifier(ast.callee)).toBe(true);
      if (isIdentifier(ast.callee)) {
        expect(ast.callee.name).toBe('max');
      }

      expect(Array.isArray(ast.arguments)).toBe(true);
      expect(ast.arguments.length).toBe(2);
      expect(isIdentifier(ast.arguments[0] as AnyAstNode)).toBe(true);
      expect(isIdentifier(ast.arguments[1] as AnyAstNode)).toBe(true);
    }
  });

  it('parses chained calls and member expressions "engine.fn(a).value"', () => {
    const ast = parse('engine.fn(a).value');

    // For many parsers, the top-level node is a MemberExpression:
    //   MemberExpression(
    //     object = CallExpression(
    //       callee = MemberExpression(engine, fn),
    //       arguments = [Identifier(a)]
    //     ),
    //     property = Identifier(value)
    //   )
    expect(isMember(ast)).toBe(true);

    if (isMember(ast)) {
      const obj = ast.object;
      expect(isCall(obj)).toBe(true);

      if (isCall(obj)) {
        const callee = obj.callee;
        expect(isMember(callee)).toBe(true);
      }
    }
  });
});

// -----------------------------------------------------------------------------
// Ternary expressions
// -----------------------------------------------------------------------------

describe('Parser – ternary (conditional) expressions', () => {
  it('parses basic ternary "cond ? a : b"', () => {
    const ast = parse('flag ? 1 : 0');
    expect(isConditional(ast)).toBe(true);

    if (isConditional(ast)) {
      // condition: flag
      expect(isIdentifier(ast.test)).toBe(true);
      // consequent: 1
      expect(isLiteral(ast.consequent)).toBe(true);
      // alternate: 0
      expect(isLiteral(ast.alternate)).toBe(true);
    }
  });

  it('parses nested ternaries with right associativity', () => {
    const ast = parse(
      'user.age < 18 ? "child" : user.age < 30 ? "young" : "adult"',
    );
    expect(isConditional(ast)).toBe(true);

    if (isConditional(ast)) {
      // root: cond1 ? "child" : (cond2 ? "young" : "adult")
      const alt = ast.alternate;
      expect(isConditional(alt as AnyAstNode)).toBe(true);
    }
  });
});

// -----------------------------------------------------------------------------
// Location / position info (if implemented)
// -----------------------------------------------------------------------------

describe('Parser – location info (start / end / loc)', () => {
  it('exposes start/end or loc information on the root node when available', () => {
    const ast = parse('user.age + 1');

    // These checks are purposely loose: we only assert *presence* and type,
    // not exact values, so the implementation is free to choose details.
    const n = ast as AnyAstNode & {
      start?: number;
      end?: number;
      loc?: { start: unknown; end: unknown };
    };

    if (typeof n.start !== 'undefined' && typeof n.end !== 'undefined') {
      expect(typeof n.start).toBe('number');
      expect(typeof n.end).toBe('number');
      expect(n.end).toBeGreaterThan(n.start);
    } else if (n.loc) {
      expect(n.loc).toHaveProperty('start');
      expect(n.loc).toHaveProperty('end');
    } else {
      // If your parser does not expose location info, you can relax this test
      // or treat it as a TODO.
      expect(true).toBe(true);
    }
  });
});

// -----------------------------------------------------------------------------
// Parse-time errors & SafexprError
// -----------------------------------------------------------------------------

describe('Parser – error handling', () => {
  it('throws SafexprError for invalid expressions with column/snippet', () => {
    const invalid = 'a + (b *';

    let caught: unknown;
    try {
      parse(invalid);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(SafexprError);
    const se = caught as SafexprError;

    expect(typeof se.message).toBe('string');
    expect(typeof se.column).toBe('number');
    expect(typeof se.snippet).toBe('string');
    expect(se.snippet.length).toBeGreaterThan(0);
  });

  it('points near the offending token in the snippet for simple errors', () => {
    const invalid = 'a && && b';

    let caught: unknown;
    try {
      parse(invalid);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(SafexprError);
    const se = caught as SafexprError;

    // We only assert that the error column is within the string length
    // and that the snippet looks non-empty. Exact formatting is up to you.
    expect(se.column).toBeGreaterThan(0);
    expect(se.column).toBeLessThanOrEqual(invalid.length);
    expect(se.snippet.length).toBeGreaterThan(0);
  });

  it('fails fast on completely empty input', () => {
    let caught: unknown;
    try {
      parse('');
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
  });
});
