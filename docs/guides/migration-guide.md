# Migration Guide

This guide helps you migrate **existing rule/expressions systems** to SafExpr.

It’s written for teams that currently use:

- raw `eval` / `new Function` with user-provided expressions;
- ad-hoc “mini languages” embedded in code;
- other expression engines (e.g. JavaScript-like mini interpreters);
- JSON-based rule formats (e.g. JSON Logic).

SafExpr’s goals:

- **Security first** – no `eval`, no globals, no prototype tricks;
- **Predictable syntax** – small, JavaScript-like expression subset;
- **Strong DX** – type hints, good error messages, testable architecture.

---

## 1. Migration overview

### 1.1. The basic shape

In almost all migrations, you move from something like:

```ts
// Before (eval / Function / ad-hoc engine)
const expr = 'user.age >= 18 && user.country === "US"';
const result = eval(expr); // or customEngine.run(expr, ctx)
````

to:

```ts
// After (SafExpr)
import { compile } from 'safexpr';

type Ctx = {
  user: { age: number; country: string };
};

const compiled = compile<Ctx, boolean>('user.age >= 18 && user.country == "US"');
const result = compiled.eval({ user: { age: 20, country: 'US' } });
```

Or, with a shared engine and helpers:

```ts
import { createEngine } from 'safexpr';

type Ctx = { user: { age: number; premium: boolean } };

const engine = createEngine().withFunction(
  'segment',
  (age: number) => (age < 18 ? 'child' : age < 30 ? 'young-adult' : 'adult'),
);

const expr = engine.compile<Ctx, string>('segment(user.age)');
const label = expr.eval({ user: { age: 24, premium: true } });
```

You keep the **inputs** and **outputs** the same; you change:

* the **expression syntax** slightly (where needed);
* how expressions are **compiled and executed**.

---

## 2. Understanding SafExpr’s model

Before migration, internalize these core concepts:

### 2.1. Expressions are pure and context-based

* Expressions are **pure**: they can read data from the context, call helper
  functions, and produce a result.
* They do **not** mutate context, write to globals, or perform I/O.

```ts
type Context = {
  user: { age: number; premium: boolean };
  order: { subtotal: number };
};

const compiled = compile<Context, boolean>(
  'user.premium && order.subtotal >= 100',
);
const ok = compiled.eval({
  user: { age: 27, premium: true },
  order: { subtotal: 120 },
});
```

### 2.2. Restricted syntax for safety

SafExpr intentionally **does not support**:

* statements: `if`, `for`, `while`, `switch`, `return`, `try/catch`, etc.;
* assignments: `=`, `+=`, `++`, `--`, etc.;
* dynamic code: `eval`, `Function`, `new`, `class`;
* global access: `process`, `globalThis`, `window`, `document`, etc.;
* prototype escape hatches: `__proto__`, `constructor`, `.prototype`.

See [`docs/guides/expressions-syntax.md`](./expressions-syntax.md) for details.

### 2.3. Engines & helpers

`createEngine` lets you register **trusted helpers**:

* They can encapsulate complex logic;
* They’re reusable across many expressions;
* They separate what is allowed **inside** expressions from what remains in
  **normal TypeScript/JavaScript**.

See [`docs/api/engine.md`](../api/engine.md) and [`docs/api/plugins.md`](../api/plugins.md).

---

## 3. Migrating from `eval` / `Function`

This is the most common and most important migration path.

### 3.1. Typical “before” setup

```ts
// Dangerous: user can run arbitrary JS in your process.
function evalRule(rule: string, context: any): any {
  const fn = new Function('ctx', `with (ctx) { return (${rule}); }`);
  return fn(context);
}

const rule = 'user.age >= 18 && process.env.SECRET !== undefined';
const result = evalRule(rule, { user: { age: 25 } });
```

Problems:

* Full access to **process**, **filesystem**, **network** (via imported modules);
* Prototype pollution via `__proto__`, `constructor`, etc.;
* Hard to constrain CPU/time usage.

### 3.2. After: SafExpr + `compile`

Drop `with` / `new Function` and compile once:

```ts
import { compile } from 'safexpr';

type RuleContext = {
  user: { age: number; country: string };
};

function evalRule(rule: string, context: RuleContext): boolean {
  const compiled = compile<RuleContext, boolean>(rule);
  return compiled.eval(context);
}
```

**Key differences:**

* `rule` is interpreted in a **sandboxed expression language**;
* there is **no** access to `process`, `require`, etc., unless you explicitly
  provide *trusted helpers* (and even then only in controlled ways);
* any attempt to use disallowed constructs leads to `SafexprError`.

### 3.3. Migrating “with (ctx)” usage

If you previously relied on `with (ctx)` so expressions could refer to fields
directly (e.g. `age >= 18` instead of `user.age >= 18`), you have options:

1. **Wrap your context** to keep property names flat:

   ```ts
   type RuleContext = {
     age: number;
     country: string;
   };

   // code side:
   const ctx: RuleContext = {
     age: user.age,
     country: user.country,
   };

   const compiled = compile<RuleContext, boolean>('age >= 18 && country == "US"');
   compiled.eval(ctx);
   ```

2. **Adjust your expression strings** to include the right path (`user.age`).

   * If you store rules in DB, this is a one-time migration (scriptable).
   * You can even support both forms temporarily (e.g. rewrite rules on load).

### 3.4. Handling JS-only features

Some expressions may rely on full JS, e.g.:

```txt
user.tags.includes("beta") && (Date.now() - signupTs) > 7 * 24 * 60 * 60 * 1000
```

To migrate:

1. **Move complex logic into helpers**:

   ```ts
   const engine = createEngine()
     .withFunction('hasTag', (tags: string[], tag: string) => tags.includes(tag))
     .withFunction(
       'daysSince',
       (timestampMs: number): number => (Date.now() - timestampMs) / 86400000,
     );
   ```

2. **Rewrite expressions to use helpers**:

   ```txt
   hasTag(user.tags, "beta") && daysSince(signupTs) > 7
   ```

3. **Keep time-sensitive or random behavior out of expressions** if you want
   determinism in tests (you can inject dates via context instead).

---

## 4. Migrating from other expression engines

SafExpr is JS-like, so many engines map fairly directly. Common patterns:

### 4.1. Syntax differences

Check these first:

* `===` / `!==` → use `==` / `!=` (or helpers):

  ```txt
  // before
  user.country === "US"

  // after
  user.country == "US"
  ```

* `&&` / `||` / `!` – same semantics and precedence;

* `in`, `instanceof`, bitwise operators, regex literals, etc. are **not**
  part of core SafExpr – move them into helpers if needed.

Example: migrating `value in allowed`:

```ts
// before in JS-like engine
"US" in allowedCountries

// after
contains(allowedCountries, "US")
```

with:

```ts
const engine = createEngine().withFunction(
  'contains',
  <T,>(arr: T[], value: T) => arr.includes(value),
);
```

### 4.2. Replacing engine-built-in functions

If your old engine provided built-ins like `min`, `max`, `sum`, etc.:

1. Create a **plugin** that re-implements them as helpers;
2. Apply the plugin to your engine.

```ts
type Engine = ReturnType<typeof createEngine>;

function legacyMathCompatibilityPlugin(engine: Engine): Engine {
  return engine
    .withFunction('min', (a: number, b: number) => Math.min(a, b))
    .withFunction('max', (a: number, b: number) => Math.max(a, b))
    .withFunction('sum', (items: number[]) =>
      items.reduce((acc, n) => acc + n, 0),
    );
}
```

This lets you keep most expressions **unchanged** while using SafExpr’s
sandboxed evaluation.

### 4.3. JSON-based rule formats (JSON Logic, etc.)

If your current system uses a **JSON AST** rather than strings (e.g. JSON Logic):

```json
{ "and": [
  { ">=": [ { "var": "user.age" }, 18 ] },
  { "==": [ { "var": "user.country" }, "US" ] }
]}
```

You have two options:

1. **Keep JSON format, generate SafExpr strings at runtime**

   * Write a small translator that converts the JSON tree into an expression
     string like: `user.age >= 18 && user.country == "US"`.
   * Compile that expression via SafExpr.
   * Advantage: you keep existing data model, but change evaluation engine.

2. **Migrate rules to strings & SafExpr syntax**

   * One-time migration where you map JSON structures to textual expressions.
   * For large rule sets, write a script to generate candidate expressions and
     run tests to verify equivalence.

---

## 5. Mapping features one-by-one

### 5.1. Allowed vs disallowed constructs

| Feature                       | SafExpr support                  | Migration strategy                       |
| ----------------------------- | -------------------------------- | ---------------------------------------- |
| Arithmetic `+ - * / %`        | ✅ fully supported                | none                                     |
| Comparisons `< <= > >= == !=` | ✅ fully supported                | use `==`/`!=` instead of `===`/`!==`     |
| Logical `&& \|\| !`           | ✅ short-circuit semantics        | none                                     |
| `??` (nullish coalescing)     | ✅ (if enabled)                   | use helpers/null checks if not available |
| Ternary `cond ? a : b`        | ✅                                | none                                     |
| Property access `a.b`         | ✅                                | none                                     |
| Array access `arr[i]`         | ✅                                | none                                     |
| `if`, `for`, `while`, …       | ❌                                | move into helpers                        |
| Assignment `=`, `+=`, …       | ❌                                | move into helpers / remove side effects  |
| `eval`, `Function`, `new`     | ❌                                | move to trusted JS functions if needed   |
| `process`, `window`, …        | ❌ (blocked)                      | move to helpers / inject via context     |
| `__proto__`, `constructor`    | ❌ (blocked)                      | refactor (security risk)                 |
| Regex literals `/.../`        | ❌ (core) – implement via helpers | helper `match(value, pattern)`           |

### 5.2. Turning imperative logic into expressions + helpers

**Before (imperative in JS):**

```ts
function discount(user: User, order: Order): number {
  if (!user.premium) return 0;
  if (order.subtotal >= 200) return order.subtotal * 0.2;
  if (order.subtotal >= 100) return order.subtotal * 0.12;
  return 0;
}
```

**After (helper + expression):**

```ts
const engine = createEngine()
  .withFunction('discount', (subtotal: number, premium: boolean): number => {
    if (!premium) return 0;
    if (subtotal >= 200) return subtotal * 0.2;
    if (subtotal >= 100) return subtotal * 0.12;
    return 0;
  });

const expr = engine.compile<{
  user: { premium: boolean };
  order: { subtotal: number };
}, number>('discount(order.subtotal, user.premium)');
```

---

## 6. Migration strategy: step-by-step

### 6.1. Step 1 – Inventory existing rules

* Where do expressions live?

  * Database, config files, code, UI, templates?
* How are they evaluated today?

  * `eval`, `Function`, custom interpreter, third-party library?
* What is their **input context**?

  * Data shape (TypeScript types if possible).
* What are safety requirements?

  * Are users untrusted? Can they craft arbitrary expressions?

Document a few representative examples for each “rule family”.

### 6.2. Step 2 – Codify the context as TypeScript types

Create interfaces that reflect what expressions are allowed to see:

```ts
export type RuleContext = {
  user: {
    id: string;
    age: number;
    country: string;
    premium: boolean;
  };
  order: {
    subtotal: number;
    shipping: number;
    taxRate: number;
  };
};
```

These types will be used with `compile<RuleContext, Result>()` and in your
engine calls.

### 6.3. Step 3 – Build an Engine + plugins

Define a single “canonical” engine per domain:

```ts
import { createEngine } from 'safexpr';

export type Engine = ReturnType<typeof createEngine>;

export function createRuleEngine(): Engine {
  return createEngine()
    // math helpers
    .withFunction('round2', (n: number) => Math.round(n * 100) / 100)
    .withFunction('clamp', (x: number, min: number, max: number) =>
      x < min ? min : x > max ? max : x,
    )
    // business-specific helpers
    .withFunction('discountFor', (subtotal: number, premium: boolean) => {
      if (!premium) return 0;
      if (subtotal >= 200) return subtotal * 0.2;
      if (subtotal >= 100) return subtotal * 0.12;
      return 0;
    });
}
```

Now every expression is compiled with this engine:

```ts
const engine = createRuleEngine();
const expr = engine.compile<RuleContext, number>(
  'round2((order.subtotal - discountFor(order.subtotal, user.premium) + order.shipping) * (1 + order.taxRate))',
);
```

### 6.4. Step 4 – Translate existing rules

For each rule:

1. Take the **original expression string** or JSON AST;
2. Produce the equivalent **SafExpr expression string**;
3. Save alongside the original (for gradual rollout).

You can start with a **small subset** of rules and verify correctness with
unit tests:

```ts
// tests/migration/discount-rules.spec.ts
import { createRuleEngine } from '../../src/rules/engine';

const engine = createRuleEngine();

it('discount rule matches legacy behavior', () => {
  const legacy = (user: User, order: Order) => {
    // copy logic from old system here (or import it)
  };

  const SafExprRule = engine.compile<{ user: User; order: Order }, number>(
    'discountFor(order.subtotal, user.premium)',
  );

  const ctx = { user: { /* ... */ }, order: { /* ... */ } };

  expect(SafExprRule.eval(ctx)).toBe(legacy(ctx.user, ctx.order));
});
```

### 6.5. Step 5 – Shadow mode

Before fully switching:

* **Evaluate both** old engine and SafExpr for each rule;
* Log mismatches (or alert) and inspect them;
* Add test cases for every mismatch you find.

Once you’re comfortable, flip the switch so SafExpr becomes the source of truth.

### 6.6. Step 6 – Decommission old engine

When:

* all critical rule sets have SafExpr equivalents;
* your tests and shadow-mode logs show no regressions;
* performance is acceptable (see below);

then:

* remove `eval` / `new Function`;
* delete old rule engine code;
* treat SafExpr as your single source of truth.

---

## 7. Performance considerations

SafExpr’s performance characteristics:

* **Compile time** – more expensive than evaluation; do it once per unique
  expression string, not on every request:

  * cache compiled expressions in memory;
  * or pre-compile known rules at startup.
* **Eval time** – predictable and bounded (esp. with engine limits).

### 7.1. Caching

A simple cache:

```ts
const cache = new Map<string, ReturnType<typeof compile>>();

export function compileCached<Ctx, R>(source: string) {
  let compiled = cache.get(source) as
    | ReturnType<typeof compile<Ctx, R>>
    | undefined;

  if (!compiled) {
    compiled = compile<Ctx, R>(source);
    cache.set(source, compiled as any);
  }
  return compiled;
}
```

With an engine:

```ts
const engine = createRuleEngine();
const cache = new Map<string, ReturnType<typeof engine.compile>>();

export function compileWithEngineCached<Ctx, R>(source: string) {
  let compiled = cache.get(source) as any;
  if (!compiled) {
    compiled = engine.compile<Ctx, R>(source);
    cache.set(source, compiled);
  }
  return compiled as ReturnType<typeof engine.compile<Ctx, R>>;
}
```

### 7.2. DoS protection

If you accept untrusted expressions from users, enable **limits**:

```ts
const engine = createEngine({
  maxExpressionLength: 2_000,
  maxAstDepth: 64,
  maxEvalOperations: 10_000,
});
```

See tests under `tests/security/dos-limits.spec.ts` for the spec-like
behavior around very long or deeply nested expressions.

---

## 8. Common migration pitfalls

1. **Relying on globals by accident**

   * If your old expressions use `process.env`, `Date`, `Math`, etc.
   * Migration: either:

     * expose them as helpers (trusted surface), or
     * inject values via context and keep helpers pure.

2. **Implicit conversions**

   * `===` vs `==`, string vs number comparison.
   * Write explicit comparisons or add helpers like `eq(a, b)`.

3. **Side effects inside expressions**

   * If rules used to mutate context (`payload.extra = 42`), you must:

     * move that logic into regular JS code (after evaluation), or
     * expose a safe helper that implements the desired side-effect (only if
       you really need it and you trust the rule authors).

4. **Prototype tricks**

   * Any use of `__proto__`, `.constructor`, `.prototype` should be treated
     as a **security smell**. Clean it up during migration.

5. **Error handling differences**

   * SafExpr throws `SafexprError` with `column` + `snippet` – integrate this
     into your logging / UI to show **which part** of the rule is invalid.

---

## 9. Checklist

**Before migration**

* [ ] Inventory where and how expressions are stored.
* [ ] Define TypeScript types for rule contexts.
* [ ] Decide which helpers you’ll expose (math, collections, domain-specific).

**During migration**

* [ ] Implement a canonical `createRuleEngine()` with plugins.
* [ ] Migrate a small subset of rules; write equivalence tests vs legacy.
* [ ] Run in shadow mode (both engines), track mismatches.

**After migration**

* [ ] Remove `eval` / `new Function` usage.
* [ ] Enable engine limits (`maxExpressionLength`, `maxAstDepth`, etc.).
* [ ] Document your SafExpr subset and helper functions for rule authors.
* [ ] Add regression tests for every bug found during migration.

---

## 10. Where to go next

* **API reference**

  * [`docs/api/compile.md`](../api/compile.md)
  * [`docs/api/engine.md`](../api/engine.md)
  * [`docs/api/plugins.md`](../api/plugins.md)

* **Guides**

  * [`docs/guides/expressions-syntax.md`](./expressions-syntax.md)

* **Examples**

  * `examples/basic-node/`
  * `examples/react-playground/`

* **Tests as specification**

  * `tests/unit/engine.spec.ts`
  * `tests/unit/evaluator.spec.ts`
  * `tests/unit/plugins.spec.ts`
  * `tests/security/*.spec.ts`

Treat this guide as a **playbook** you can adapt to your own environment:
start small, keep a clear equivalence suite, and let SafExpr gradually
replace your old rule engine with something safer, more testable, and easier
to reason about.
