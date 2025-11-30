// SafExpr/tests/security/globals-access.spec.ts
//
// Security-focused tests for *global access isolation* in Safexpr.
//
// Goals / assumptions:
//
//  - User expressions MUST NOT be able to:
//      * Access Node / browser globals (`globalThis`, `global`, `window`, `process`, etc.)
//      * Invoke dynamic code primitives (`eval`, `Function`, etc.)
//      * Reach object prototypes via dangerous properties (`__proto__`, `constructor`, `prototype`)
//      * Escape the provided context.
//  - Reasonable, safe expressions with plain context access MUST still work.
//  - These tests are partly *aspirational* and can act as a specification for
//    the engine’s security behavior.
//
// If your current implementation is looser, you can:
//  - Start by making these tests “documented expectations”.
//  - Then tighten the implementation until they pass.

import { describe, it, expect } from 'vitest';
import { compile, createEngine, SafexprError } from '../../src';

// -----------------------------------------------------------------------------
// Shared types & context
// -----------------------------------------------------------------------------

type SafeContext = {
  value: number;
  label: string;
  safeEnv: {
    NODE_ENV: string;
  };
  user: {
    id: string;
    name: string;
  };
};

const ctx: SafeContext = {
  value: 42,
  label: 'ok',
  safeEnv: {
    NODE_ENV: 'test',
  },
  user: {
    id: 'u1',
    name: 'Alice',
  },
};

// Helper: compile + eval
function evalExpr<R = unknown>(expr: string, context: SafeContext = ctx): R {
  const compiled = compile<SafeContext, R>(expr);
  return compiled.eval(context);
}

// -----------------------------------------------------------------------------
// Baseline sanity checks
// -----------------------------------------------------------------------------

describe('Security – globals isolation: baseline', () => {
  it('evaluates safe expressions with explicit context only', () => {
    expect(evalExpr<number>('value + 1')).toBe(43);
    expect(evalExpr<string>('label')).toBe('ok');
    expect(evalExpr<string>('user.name')).toBe('Alice');
    expect(evalExpr<string>('safeEnv.NODE_ENV')).toBe('test');
  });

  it('does not magically expose process or other globals when not in context', () => {
    let caught: unknown;

    try {
      evalExpr<unknown>('process');
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
  });
});

// -----------------------------------------------------------------------------
// Global identifiers should not be accessible
// -----------------------------------------------------------------------------

describe('Security – globals isolation: forbidden global identifiers', () => {
  // Identifiers that typically refer to powerful globals in Node / browser.
  const forbiddenIdentifiers = [
    'globalThis',
    'global',
    'window',
    'self',
    'process',
    'require',
    'module',
    '__dirname',
    '__filename',
    'document',
  ];

  for (const ident of forbiddenIdentifiers) {
    it(`rejects direct access to "${ident}"`, () => {
      let caught: unknown;

      try {
        evalExpr<unknown>(ident);
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeDefined();
      // If the engine routes this through SafexprError, UX is better:
      //   expect(caught).toBeInstanceOf(SafexprError);
    });
  }

  it('rejects use of eval and Function constructors', () => {
    const dangerous = [
      'eval("1 + 1")',
      'Function("return 1 + 1")()',
      'Function("return process")()',
    ];

    for (const expr of dangerous) {
      let caught: unknown;
      try {
        evalExpr<unknown>(expr);
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeDefined();
    }
  });

  it('rejects obvious constructor escape patterns', () => {
    const dangerous = [
      // Classic JS sandbox-escape patterns:
      '({}).constructor.constructor("return process")()',
      'user.constructor.constructor("return globalThis")()',
      'value.constructor.constructor("return this")()',
    ];

    for (const expr of dangerous) {
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
// Prototype pollution / dangerous properties
// -----------------------------------------------------------------------------

describe('Security – globals isolation: prototype & dangerous property access', () => {
  const protoExpressions = [
    'user.__proto__',
    'safeEnv.__proto__',
    'value.__proto__',
    'user.constructor',
    'user.constructor.prototype',
  ];

  for (const expr of protoExpressions) {
    it(`rejects access to dangerous property pattern in "${expr}"`, () => {
      let caught: unknown;

      try {
        evalExpr<unknown>(expr);
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeDefined();
    });
  }

  it('still allows access to normal properties like user.name', () => {
    expect(evalExpr<string>('user.name')).toBe('Alice');
  });
});

// -----------------------------------------------------------------------------
// Engine-level behavior and configuration (aspirational)
// -----------------------------------------------------------------------------

describe('Security – globals isolation: engine behavior', () => {
  it('default engine does not expose globals even inside functions', () => {
    const engine = createEngine()
      .withFunction('echo', <T,>(v: T) => v)
      // This function itself *could* access globals because it is trusted code.
      // The sandbox boundary is the expression, not the function body.
      .withFunction('trustedFn', () => {
        // Example of trusted code: it could do almost anything,
        // but that is an application responsibility.
        return typeof globalThis !== 'undefined' ? 'has-global' : 'no-global';
      });

    // Expressions should still not be able to reach globals on their own:
    const expr = 'echo(value) + 1';
    const compiled = engine.compile<SafeContext, number>(expr);
    const result = compiled.eval(ctx);
    expect(result).toBe(43);

    // We can still call trustedFn, but any global usage is inside *trusted* code.
    const trustedExpr = 'trustedFn()';
    const trustedCompiled = engine.compile<SafeContext, string>(trustedExpr);
    const trustedResult = trustedCompiled.eval(ctx);
    expect(trustedResult === 'has-global' || trustedResult === 'no-global').toBe(true);
  });

  it('optionally may expose a debug-friendly error when globals are referenced', () => {
    const expr = 'globalThis'; // clearly forbidden

    let caught: unknown;
    try {
      evalExpr<unknown>(expr);
    } catch (err) {
      caught = err;
    }

    if (caught instanceof SafexprError) {
      expect(typeof caught.message).toBe('string');
      // Ideally, error message helps users understand what went wrong:
      // e.g. "Access to global identifier 'globalThis' is not allowed"
      expect(caught.message.toLowerCase()).toContain('global');
    } else {
      expect(caught).toBeDefined();
    }
  });

  // This block is intentionally "spec-like". It assumes the engine will eventually
  // expose an explicit opt-out for strict global isolation (NOT recommended in production).
  //
  // If you do not plan to support such an option, you can remove or adjust this test.
  it('can (optionally) relax global protection via explicit unsafe configuration', () => {
    // Example of a *dangerous* configuration. The exact option name is up to the
    // implementation – this test documents the idea.
    //
    // NOTE: Comment this out or adjust if your engine does not plan to support it.
    const engine = createEngine({
      // hypothetical option:
      // allowUnsafeGlobalAccess: true,
    } as any);

    const expr = 'value + 1';
    const compiled = engine.compile<SafeContext, number>(expr);
    const result = compiled.eval(ctx);

    expect(result).toBe(43);

    // The behavior of something like "globalThis" in this mode is up to you.
    // A truly unsafe mode might allow it; a partially strict mode might still block it.
    // We intentionally do NOT assert anything here to avoid locking you in.
  });
});

// -----------------------------------------------------------------------------
// No accidental leakage via "this"
// -----------------------------------------------------------------------------

describe('Security – globals isolation: "this" binding', () => {
  it('does not expose a useful global object via "this"', () => {
    const expressions = [
      'this',
      'this.process',
      'this.globalThis',
      'this.window',
      'this && this.process',
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
// Shadowing and safe names
// -----------------------------------------------------------------------------

describe('Security – globals isolation: safe shadowing', () => {
  it('allows safe use of context properties that do not collide with globals', () => {
    const localCtx: SafeContext = {
      ...ctx,
      safeEnv: { NODE_ENV: 'production' },
      user: { id: 'u2', name: 'Bob' },
    };

    expect(evalExpr<string>('safeEnv.NODE_ENV', localCtx)).toBe('production');
    expect(evalExpr<string>('user.name', localCtx)).toBe('Bob');
  });

  it('does not accidentally allow real global access even if context has similar shape', () => {
    const trickyCtx: SafeContext = {
      ...ctx,
      // Lookalike, but should still be isolated within the context object,
      // not interpreted as the ambient Node "process".
      safeEnv: { NODE_ENV: 'env-from-context' },
    };

    // Expression only sees context.safeEnv, not Node.js process.env.
    const expr = 'safeEnv.NODE_ENV';
    const value = evalExpr<string>(expr, trickyCtx);
    expect(value).toBe('env-from-context');
  });
});
