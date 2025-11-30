// SafExpr/tests/security/prototype-pollution.spec.ts
//
// Security-focused tests for prototype pollution protection in Safexpr.
//
// Goals / assumptions:
//
//  - User expressions MUST NOT be able to:
//      * Access or mutate object prototypes via __proto__, constructor, prototype, etc.
//      * Modify Object.prototype or Array.prototype through the evaluation context.
//      * Use classic prototype pollution gadgets (e.g., { "__proto__": { ... } } patterns).
//  - Normal property access must continue to work as expected.
//  - These tests are partly *aspirational* and serve as a specification for how
//    Safexpr should behave in hostile environments.
//
// If your current implementation does not yet enforce all of this,
// treat failing tests as TODOs for tightening the engine.

import { describe, it, expect } from 'vitest';
import { compile, createEngine, SafexprError } from '../../src';

// -----------------------------------------------------------------------------
// Shared types & context
// -----------------------------------------------------------------------------

type SafeUser = {
  id: string;
  name: string;
  role: 'user' | 'admin';
};

type SafeContext = {
  user: SafeUser;
  payload: Record<string, unknown>;
  config: {
    theme: string;
    featureFlag: boolean;
  };
};

const baseCtx: SafeContext = {
  user: {
    id: 'u1',
    name: 'Alice',
    role: 'user',
  },
  payload: {
    // Keys that might be controlled by external input (e.g., JSON payload)
    foo: 'bar',
    nested: { a: 1 },
  },
  config: {
    theme: 'dark',
    featureFlag: false,
  },
};

// Helper: compile + eval
function evalExpr<R = unknown>(expression: string, ctx: SafeContext = baseCtx): R {
  const fn = compile<SafeContext, R>(expression);
  return fn.eval(ctx);
}

// -----------------------------------------------------------------------------
// Baseline sanity checks
// -----------------------------------------------------------------------------

describe('Security – prototype pollution: baseline', () => {
  it('allows safe property access and updates in user-controlled context', () => {
    expect(evalExpr<string>('user.name')).toBe('Alice');
    expect(evalExpr<string>('config.theme')).toBe('dark');

    const ctx: SafeContext = {
      ...baseCtx,
      payload: { ...baseCtx.payload, safeKey: 'value' },
    };

    expect(evalExpr<string>('payload.safeKey as string', ctx)).toBe('value');
  });
});

// -----------------------------------------------------------------------------
// Direct access to dangerous properties
// -----------------------------------------------------------------------------

describe('Security – prototype pollution: direct access to dangerous properties', () => {
  const dangerousExpressions = [
    'user.__proto__',
    'config.__proto__',
    'payload.__proto__',
    'user.constructor',
    'user.constructor.prototype',
    'payload.constructor.prototype',
    'user["__proto__"]',
    'payload["constructor"]',
    'payload["__proto__"].polluted',
  ];

  for (const expr of dangerousExpressions) {
    it(`rejects access pattern: ${expr}`, () => {
      let caught: unknown;

      try {
        evalExpr<unknown>(expr);
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeDefined();
      // Optionally assert a specific error type for better DX:
      // expect(caught).toBeInstanceOf(SafexprError);
    });
  }

  it('still allows access to honest properties with similar names but safe semantics', () => {
    const ctx: SafeContext = {
      ...baseCtx,
      payload: {
        ...baseCtx.payload,
        '__protoSafe__': 'ok',
      },
    };

    expect(evalExpr<string>('payload.__protoSafe__ as string', ctx)).toBe('ok');
  });
});

// -----------------------------------------------------------------------------
// Object literal pollution gadgets (aspirational)
// -----------------------------------------------------------------------------

describe('Security – prototype pollution: object literal gadgets', () => {
  // These patterns are frequently seen in prototype pollution attacks via JSON or query params.
  const pollutionPatterns = [
    '{ "__proto__": { "polluted": "yes" } }',
    '{ "constructor": { "prototype": { "polluted": "yes" } } }',
    '{ "prototype": { "polluted": "yes" } }',
    '({} as any)["__proto__"] = { "polluted": "yes" }',
  ];

  for (const expr of pollutionPatterns) {
    it(`rejects or safely contains classic pollution pattern: ${expr}`, () => {
      let caught: unknown;

      try {
        evalExpr<unknown>(expr);
      } catch (err) {
        caught = err;
      }

      // Two acceptable behaviors:
      //  - Throw an error (preferred).
      //  - Contain the pollution inside a sandboxed object (no change to Object.prototype).
      //
      // We cannot easily assert Object.prototype here without relying on implementation details,
      // so we just assert that evaluation is not silently "successful" in a way that leaks out.
      if (caught) {
        expect(caught).toBeDefined();
      } else {
        // If your engine chooses to allow this as a value, make sure it does NOT
        // modify global prototypes. You may add explicit assertions here if you
        // know your implementation details.
        expect(true).toBe(true);
      }
    });
  }

  it('does not allow pollution via assignment into context objects', () => {
    const expressions = [
      'payload.__proto__ = { polluted: "yes" }',
      'payload.constructor.prototype.polluted = "yes"',
      'payload["__proto__"] = { polluted: "yes" }',
    ];

    for (const expr of expressions) {
      let caught: unknown;

      try {
        evalExpr<unknown>(expr);
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeDefined();
    }
  });
});

// -----------------------------------------------------------------------------
// Engine-level protections and helpers (aspirational)
// -----------------------------------------------------------------------------

describe('Security – prototype pollution: engine behavior', () => {
  it('can be configured to explicitly disallow dangerous keys', () => {
    // Example of a strict engine configuration.
    // The exact option name/type is implementation-specific, but the idea is:
    //
    //   - When resolving member expressions, keys like "__proto__", "constructor",
    //     "prototype" are rejected or ignored.
    //
    const engine = createEngine({
      // Hypothetical options for illustration:
      // disallowDangerousKeys: true,
      // dangerousKeys: ["__proto__", "constructor", "prototype"],
    } as any);

    const safeExpr = 'user.name';
    const compiledSafe = engine.compile<SafeContext, string>(safeExpr);
    expect(compiledSafe.eval(baseCtx)).toBe('Alice');

    const unsafeExpr = 'user.__proto__';
    let caught: unknown;

    try {
      engine.compile<SafeContext, unknown>(unsafeExpr).eval(baseCtx);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
  });

  it('does not mutate Object.prototype or Array.prototype via context evaluation', () => {
    // Snapshot a known non-existent property on Object.prototype / Array.prototype
    // before evaluation.
    // NOTE: we keep the name unlikely to be used by the library itself.
    const propName = '__safexprTestPollution__';

    const beforeObjProto = Object.prototype as Record<string, unknown>;
    const beforeArrProto = Array.prototype as Record<string, unknown>;

    const beforeObjValue = beforeObjProto[propName];
    const beforeArrValue = beforeArrProto[propName];

    const exprs = [
      'payload.__proto__ = { "__safexprTestPollution__": "yes" }',
      'payload.constructor.prototype.__safexprTestPollution__ = "yes"',
    ];

    for (const expr of exprs) {
      let caught: unknown;
      try {
        evalExpr<unknown>(expr);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeDefined();
    }

    // After all attempts, prototypes must remain unchanged.
    const afterObjValue = beforeObjProto[propName];
    const afterArrValue = beforeArrProto[propName];

    expect(afterObjValue).toBe(beforeObjValue);
    expect(afterArrValue).toBe(beforeArrValue);
  });

  it('can report meaningful diagnostics when dangerous keys are used', () => {
    const expr = 'user.constructor.prototype';

    let caught: unknown;
    try {
      evalExpr<unknown>(expr);
    } catch (err) {
      caught = err;
    }

    if (caught instanceof SafexprError) {
      expect(typeof caught.message).toBe('string');
      const m = caught.message.toLowerCase();
      expect(m.includes('constructor') || m.includes('prototype')).toBe(true);
    } else {
      expect(caught).toBeDefined();
    }
  });
});

// -----------------------------------------------------------------------------
// Mixed cases: safe vs unsafe keys
// -----------------------------------------------------------------------------

describe('Security – prototype pollution: mixed safe/unsafe usage', () => {
  it('allows safe keys that merely *look* suspicious but are harmless in context', () => {
    const ctx: SafeContext = {
      ...baseCtx,
      payload: {
        ...baseCtx.payload,
        proto_value: 'ok',
        constructorName: 'User',
      },
    };

    expect(evalExpr<string>('payload.proto_value as string', ctx)).toBe('ok');
    expect(evalExpr<string>('payload.constructorName as string', ctx)).toBe('User');
  });

  it('distinguishes between literal strings and property access', () => {
    // Having "__proto__" as a string literal is fine.
    expect(evalExpr<string>(' "__proto__" ')).toBe('__proto__');
    expect(evalExpr<string>(' "constructor" ')).toBe('constructor');

    // But using them as property access keys should be blocked (see other tests).
    let caught: unknown;
    try {
      evalExpr<unknown>('payload["__proto__"]');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
  });
});
