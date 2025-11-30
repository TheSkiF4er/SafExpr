# Getting Started with SafExpr

SafExpr is a **safe, minimal, type-friendly expression engine** for
JavaScript/TypeScript.

It lets you evaluate **untrusted user expressions** like:

```txt
user.premium && user.age >= 18
  ? (order.subtotal * 0.9 + order.shipping) * (1 + order.taxRate)
  : (order.subtotal + order.shipping) * (1 + order.taxRate)
````

without using `eval`, without exposing Node/browser globals, and with a clean,
typed API.

---

## 1. Installation

Install from npm:

```bash
npm install safexpr
# or
yarn add safexpr
# or
pnpm add safexpr
```

SafExpr is written in TypeScript and ships with type declarations out of the box.

---

## 2. The 60-second intro

There are two main entry points:

* [`compile`](./api/compile.md) – simple one-off compilation;
* [`createEngine`](./api/engine.md) – reusable engine with helpers & options.

### 2.1. Minimal example (`compile`)

```ts
import { compile } from 'safexpr';

type Context = {
  price: number;
  qty: number;
};

const expr = 'price * qty';

const compiled = compile<Context, number>(expr);

const total = compiled.eval({ price: 19.99, qty: 3 });
// total === 59.97
```

### 2.2. Engine example (`createEngine`)

```ts
import { createEngine } from 'safexpr';

type Context = {
  user: { age: number; premium: boolean };
  order: { subtotal: number; shipping: number; taxRate: number };
};

const engine = createEngine()
  .withFunction('discountFor', (subtotal: number, premium: boolean) => {
    if (!premium) return 0;
    if (subtotal >= 200) return subtotal * 0.2;
    if (subtotal >= 100) return subtotal * 0.12;
    return 0;
  })
  .withFunction('round2', (n: number) => Math.round(n * 100) / 100);

const totalExpr = engine.compile<Context, number>(
  `
  round2(
    (order.subtotal - discountFor(order.subtotal, user.premium) + order.shipping)
    * (1 + order.taxRate)
  )
  `,
);

const total = totalExpr.eval({
  user: { age: 27, premium: true },
  order: { subtotal: 150, shipping: 10, taxRate: 0.2 },
});
```

---

## 3. Core concepts

### 3.1. Expression

An **expression** is a small, JS-like string that returns a value:

```txt
price * qty
user.age >= 18 && user.country == "US"
user.premium ? "VIP" : "REGULAR"
sum(nums) / nums.length
```

Expressions:

* have **no statements** (`if`, `for`, `while`, `return`, …);
* have **no assignments** (`=`, `+=`, `++`, …);
* cannot access Node/browser **globals** (`process`, `window`, `globalThis`, …);
* cannot use **dynamic code** (`eval`, `Function`, `new`, `class`, …).

See: [`docs/guides/expressions-syntax.md`](./guides/expressions-syntax.md).

---

### 3.2. Context

The **context** is the object you pass to `eval(context)`:

```ts
type Context = {
  user: { age: number; premium: boolean };
  order: { subtotal: number };
};

const expr = compile<Context, boolean>(
  'user.premium && user.age >= 18 && order.subtotal >= 100',
);

expr.eval({
  user: { age: 25, premium: true },
  order: { subtotal: 150 },
}); // true
```

> Expressions only see what you put in the context (plus registered helpers).

---

### 3.3. `compile` vs `createEngine`

**`compile`**:

* quick, zero-config entry point;
* good for small projects, scripts, tests.

```ts
const compiled = compile<Ctx, Result>(source);
compiled.eval(ctx);
```

**`createEngine`**:

* shared **function registry** via `.withFunction(name, fn)`;
* configurable limits & safety options;
* ideal for production systems & plugin ecosystems.

```ts
const engine = createEngine(/* options? */)
  .withFunction('fn', (...args) => /* ... */);

const compiled = engine.compile<Ctx, Result>(source);
compiled.eval(ctx);
```

You can start with `compile` and later migrate to an engine without changing
much call-site code.

---

### 3.4. Types & generics

SafExpr is runtime-typed, but its API is **type-hinted**:

```ts
type Ctx = { user: { age: number } };

const compiled = compile<Ctx, string>('user.age >= 18 ? "adult" : "child"');

// ctx must match Ctx
compiled.eval({ user: { age: 21 } });

// TypeScript will complain:
// compiled.eval({ age: 21 });
// const n: number = compiled.eval({ user: { age: 21 } });
```

`Result` is **not enforced at runtime** but keeps your code and editor honest.

---

## 4. Supported syntax (overview)

SafExpr supports a focused subset of JS-like expressions:

* **Literals**

  * numbers: `0`, `42`, `3.14`, `.5`, `10.`
  * strings: `"hello"`, `'world'`
  * booleans: `true`, `false`
  * `null`
* **Identifiers & properties**

  * `price`, `qty`, `user.age`, `order.total`
  * arrays: `scores[0]`, `matrix[1][2]`
* **Arithmetic**

  * `+`, `-`, `*`, `/`, `%`, unary `-`
* **Comparisons**

  * `==`, `!=`, `<`, `<=`, `>`, `>=`
* **Logical**

  * `&&`, `||`, `!` (with short-circuit semantics)
* **Nullish**

  * `??` (if enabled by implementation)
* **Ternary**

  * `cond ? whenTrue : whenFalse`
* **Parentheses**

  * `(a + b) * c`
* **Function calls**

  * `max(a, b)`, `sum(nums)` – only for helpers registered via `withFunction`.

Details: [`docs/guides/expressions-syntax.md`](./guides/expressions-syntax.md).

---

## 5. Real-world examples

### 5.1. Filtering users

```ts
import { compile } from 'safexpr';

type User = {
  id: string;
  age: number;
  country: string;
  premium: boolean;
};

type Ctx = { user: User };

const filterExpr = compile<Ctx, boolean>(
  'user.age >= 18 && user.country == "US" && user.premium == true',
);

const users: User[] = [/* ... */];

const filtered = users.filter((user) => filterExpr.eval({ user }));
```

---

### 5.2. Feature flag rule

```ts
import { compile } from 'safexpr';

type Ctx = {
  user: {
    id: string;
    country: string;
    plan: 'free' | 'pro' | 'enterprise';
  };
};

const flagExpr = compile<Ctx, boolean>(
  'user.country == "US" && (user.plan == "pro" || user.plan == "enterprise")',
);

function isFeatureEnabled(user: Ctx['user']) {
  return flagExpr.eval({ user });
}
```

---

### 5.3. Node.js CLI

See more in [`docs/examples.md`](./examples.md), but here is a minimal CLI:

```ts
#!/usr/bin/env node
import { compile, SafexprError } from 'safexpr';

type Ctx = { x: number; y: number };

const [, , source = 'x + y'] = process.argv;
const ctx: Ctx = { x: 10, y: 5 };

try {
  const compiled = compile<Ctx, unknown>(source);
  const result = compiled.eval(ctx);
  console.log('Expression:', source);
  console.log('Context   :', ctx);
  console.log('Result    :', result);
} catch (err) {
  if (err instanceof SafexprError) {
    console.error('SafExpr error:', err.message);
    console.error('column:', err.column);
    console.error('snippet:\n' + err.snippet);
  } else {
    console.error('Unexpected error:', err);
  }
  process.exit(1);
}
```

Run:

```bash
node scripts/eval.js "x * 2 + y"
```

---

## 6. Error handling & `SafexprError`

Invalid or unsafe expressions don’t crash silently; they throw
`SafexprError` with helpful metadata.

### 6.1. Syntax error

```ts
import { compile, SafexprError } from 'safexpr';

const source = 'n * * m'; // invalid

try {
  const compiled = compile<{ n: number; m: number }, number>(source);
  compiled.eval({ n: 1, m: 2 });
} catch (err) {
  if (err instanceof SafexprError) {
    console.error('SafExpr error:', err.message);
    console.error('column:', err.column);
    console.error('snippet:\n' + err.snippet);
  } else {
    console.error('Unexpected error:', err);
  }
}
```

### 6.2. Runtime error from helpers

```ts
const engine = createEngine().withFunction('boom', () => {
  throw new Error('explosion');
});

const expr = engine.compile<{}, unknown>('boom()');

try {
  expr.eval({});
} catch (err) {
  // may be wrapped in SafexprError, or rethrown – either way, not swallowed
}
```

---

## 7. Security at a glance

SafExpr is built for **untrusted expressions**.

### 7.1. What expressions *cannot* do

From inside an expression string, users:

* **cannot** access Node/browser globals:

  ```txt
  process      // ❌
  globalThis   // ❌
  window       // ❌
  require(...) // ❌
  document     // ❌
  ```

* **cannot** execute dynamic code:

  ```txt
  eval("1 + 1")                                // ❌
  Function("return process")()                 // ❌
  ({}).constructor.constructor("return this")  // ❌
  ```

* **cannot** reach prototypes via dangerous properties:

  ```txt
  user.__proto__                 // ❌
  user.constructor               // ❌
  user.constructor.prototype     // ❌
  payload["__proto__"]          // ❌
  ```

* **cannot** mutate global prototypes:

  ```txt
  payload.__proto__ = { polluted: "yes" }                  // ❌
  payload.constructor.prototype.polluted = "yes"          // ❌
  ```

All of these behaviors are specified in tests under `tests/security/*.spec.ts`.

See: [`docs/guides/security-model.md`](./guides/security-model.md).

---

### 7.2. DoS protection (Engine options)

When you use `createEngine`, you can add **limits**:

```ts
const engine = createEngine({
  maxExpressionLength: 2_000,
  maxAstDepth: 64,
  maxEvalOperations: 10_000,
});
```

These options help protect against:

* extremely long expression strings;
* deeply nested expressions;
* excessive evaluation work.

Details: `tests/security/dos-limits.spec.ts`.

---

### 7.3. Helpers are trusted

Helpers registered with `.withFunction()` run in **normal JS**:

```ts
const engine = createEngine().withFunction('discount', (subtotal, premium) => {
  // trusted code; treat inputs as untrusted
  // can access DB, network, filesystem, process.env, etc.
});
```

Treat helpers as part of your **trusted surface**:

* validate inputs;
* keep them small and well-tested;
* avoid giving them more power than necessary.

---

## 8. Repository structure (recommended)

In this project, we use a structure roughly like:

```txt
SafExpr/
  src/                 # library source code (engine, parser, tokenizer, etc.)
  tests/
    unit/              # engine, evaluator, parser, tokenizer, plugins
    integration/       # end-to-end syntax & behavior
    security/          # globals, prototype pollution, DoS limits
  examples/
    basic-node/        # minimal Node.js usage
    react-playground/  # browser playground with React
  docs/
    api/               # compile, engine, plugins docs
    guides/            # syntax, migration, security, etc.
    examples.md        # cookbook of examples
    getting-started.md # (this file)
```

You don’t have to follow this layout exactly, but it’s a good starting point.

---

## 9. Where to go next

### 9.1. API reference

* [`docs/api/compile.md`](./api/compile.md) – the top-level `compile` function.
* [`docs/api/engine.md`](./api/engine.md) – `createEngine`, `withFunction`, options.
* [`docs/api/plugins.md`](./api/plugins.md) – how to build and compose plugins.

### 9.2. Guides

* [`docs/guides/expressions-syntax.md`](./guides/expressions-syntax.md) – full language reference.
* [`docs/guides/migration-guide.md`](./guides/migration-guide.md) – moving from `eval` or other engines.
* [`docs/guides/security-model.md`](./guides/security-model.md) – detailed security story.

### 9.3. Examples & tests

* [`docs/examples.md`](./examples.md) – cookbook of common patterns.

* `examples/basic-node/` – minimal Node CLI / script usage.

* `examples/react-playground/` – interactive playground UI.

* `tests/unit/*.spec.ts` – engine, evaluator, parser, tokenizer, plugins.

* `tests/security/*.spec.ts` – globals isolation, prototype safety, DoS limits.

* `tests/integration/*.spec.ts` – syntax & behavior end-to-end.

---

## 10. TL;DR

* Use `compile` for quick, one-off expressions.
* Use `createEngine` for real apps: shared helpers, limits, plugins.
* Expressions are **sandboxed** and only see **context + functions** you provide.
* Helpers are **trusted**; treat their inputs as untrusted.
* The tests double as an executable specification – read them!

From here, jump into [`docs/expressions-syntax.md`](./guides/expressions-syntax.md)
to see everything you can write inside an expression, or
[`docs/examples.md`](./examples.md) to copy-paste real usage patterns into
your own project.
