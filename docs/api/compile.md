# `compile`

SafExpr provides a top-level `compile` function for turning user-defined
expression strings into **reusable, type-aware evaluators**.

```ts
import { compile } from 'safexpr';
````

`compile` is the fastest way to start using SafExpr without creating an
explicit engine. It is ideal for:

* simple / one-off expressions;
* small projects that don’t need custom functions;
* tests and scripts.

For advanced scenarios (custom functions, limits, plugins), see
[`createEngine`](./createEngine.md) (hypothetical) – the API is the same,
but configured via an engine instance.

---

## Signature

```ts
declare function compile<Context, Result = unknown>(
  source: string,
): CompiledExpression<Context, Result>;
```

### Type parameters

* `Context` – the shape of the object you will pass to `eval(context)`.
* `Result` – the expected result type of the expression.

  * This is **not validated at runtime**; it is a TypeScript guideline for
    your code and editor.

### Returns: `CompiledExpression<Context, Result>`

A compiled expression object with the following shape:

```ts
type CompiledExpression<Context, Result> = {
  /**
   * Evaluate the expression against the given context object.
   * May throw SafexprError (syntax/runtime), or custom errors from
   * your own functions if you are using an Engine.
   */
  eval(context: Context): Result;

  /**
   * The original source string as passed to compile().
   */
  source: string;

  /**
   * Parsed AST representation of the expression.
   * The exact structure is implementation-specific, but at minimum:
   *   - node.type: string
   *   - node.start / node.end: numeric positions (optional)
   *   - node.loc: line/column info (optional)
   */
  ast?: unknown;
};
```

> The `ast` field is primarily for tools (debuggers, visualizers, analyzers).
> You do **not** need it for normal use.

---

## Basic usage

### Minimal example

```ts
type Context = {
  price: number;
  qty: number;
};

const expr = 'price * qty';

const compiled = compile<Context, number>(expr);

const total = compiled.eval({ price: 19.99, qty: 3 });
// total: 59.97
```

### Using nested properties

```ts
type User = {
  age: number;
  country: string;
  premium: boolean;
};

type Order = {
  subtotal: number;
  shipping: number;
  taxRate: number;
};

type Ctx = {
  user: User;
  order: Order;
};

const expr = `
  user.premium && user.age >= 18
    ? (order.subtotal * 0.9 + order.shipping) * (1 + order.taxRate)
    : (order.subtotal + order.shipping) * (1 + order.taxRate)
`;

const compiled = compile<Ctx, number>(expr);

const value = compiled.eval({
  user: { age: 27, country: 'US', premium: true },
  order: { subtotal: 150, shipping: 10, taxRate: 0.2 },
});
```

---

## Supported expression features

At a high level, `compile` supports:

* **Literals**

  * numbers: `0`, `42`, `3.14`, `.5`
  * strings: `"hello"`, `'world'`
  * booleans: `true`, `false`
  * `null`
* **Identifiers & properties**

  * `price`, `qty`, `user.age`, `order.total`
  * array access: `items[0]`, `scores[3]`
* **Arithmetic**

  * `+`, `-`, `*`, `/`, `%`, unary `-`
* **Comparisons**

  * `==`, `!=`, `>`, `>=`, `<`, `<=`
* **Logical operators**

  * `&&`, `||`, `!` (with short-circuit semantics)
* **Ternary operator**

  * `cond ? whenTrue : whenFalse`
* **Parentheses for explicit precedence**

  * `(a + b) * c`

For **function calls** and more advanced behavior, prefer an Engine:

```ts
import { createEngine } from 'safexpr';

const engine = createEngine().withFunction('max', (a: number, b: number) => Math.max(a, b));

const compiled = engine.compile<{ a: number; b: number }, number>('max(a, b)');
const result = compiled.eval({ a: 3, b: 10 }); // 10
```

---

## Type-safety with generics

SafExpr itself is runtime-typed (not fully statically typed), but the generic
parameters give you **strong hints** in your TypeScript code:

```ts
type Context = {
  user: { age: number };
};

const expr = 'user.age >= 18 ? "adult" : "child"';

const compiled = compile<Context, string>(expr);

// ✅ type-safe: context must have `user.age: number`
const label = compiled.eval({ user: { age: 21 } });

// ❌ TypeScript error: missing `user`
compiled.eval({ age: 21 });

// ❌ TypeScript error: wrong result type
const n: number = compiled.eval({ user: { age: 21 } });
```

> `Result` is a hint; SafExpr does not guarantee runtime type equality.
> If the expression evaluates to something else, TypeScript will not detect it,
> but your own runtime checks can.

---

## Error handling

`compile` may fail at two stages:

1. **Parse/compile time** — invalid syntax or disallowed constructs.
2. **Evaluation time** — accessing missing fields, calling your custom functions,
   or limit violations (if configured in an engine).

Both stages can throw a `SafexprError` (or other errors). The error object
is designed for good DX in developer tools and logs.

### SafexprError shape (conceptual)

```ts
class SafexprError extends Error {
  /** 1-based column position of the error (where available) */
  column: number;

  /** Short snippet of the expression around the error location */
  snippet: string;

  // other properties may exist, but these two are the most important
}
```

### Example: syntax error

```ts
try {
  const compiled = compile<{ x: number }, number>('x * * 2');
  compiled.eval({ x: 5 });
} catch (err) {
  if (err instanceof SafexprError) {
    console.error('SafExpr syntax error:');
    console.error('message:', err.message);
    console.error('column :', err.column);
    console.error('snippet:', err.snippet);
  } else {
    console.error('Unexpected error:', err);
  }
}
```

---

## Security model (what `compile` **does not** allow)

SafExpr is designed for **untrusted user expressions**. A compiled expression:

* **cannot** access Node / browser globals:

  * `process`, `global`, `globalThis`, `window`, `document`, etc.
* **cannot** use dynamic code execution:

  * `eval()`, `Function()`,
  * `this.constructor.constructor("return process")()`, etc.
* **cannot** reach prototypes via dangerous properties:

  * `__proto__`, `constructor`, `.prototype`, and similar escape hatches

Instead, expressions are restricted to the **explicit context** you pass to
`eval(context)`.

Bad examples that **must** fail:

```ts
compile('process.env');                     // ❌
compile('globalThis');                      // ❌
compile('({}).constructor.constructor(...)'); // ❌
compile('user.__proto__');                  // ❌
```

You can write tests around these behaviors (see `/tests/security/*.spec.ts`).

---

## Performance & reuse

Compiling is more expensive than evaluating. The intended pattern is:

1. **Compile once** per expression string.
2. **Reuse many times** with different contexts.

```ts
const compiled = compile<{ x: number }, number>('x * 2');

for (const x of [1, 2, 3, 4, 5]) {
  console.log(compiled.eval({ x }));
}
```

For many expressions, or for custom functions, use a shared Engine:

```ts
const engine = createEngine()
  .withFunction('discount', (subtotal: number, premium: boolean) =>
    premium && subtotal >= 100 ? subtotal * 0.1 : 0,
  );

const discountExpr = engine.compile<{ subtotal: number; premium: boolean }, number>(
  'discount(subtotal, premium)',
);
const labelExpr = engine.compile<{ subtotal: number; premium: boolean }, string>(
  'premium ? "VIP" : "REGULAR"',
);

discountExpr.eval({ subtotal: 150, premium: true });
labelExpr.eval({ subtotal: 150, premium: true });
```

---

## Limits & safety (aspirational)

In its simplest form, `compile` uses sensible internal defaults for:

* maximum expression length;
* maximum AST depth (nesting level);
* evaluation step limits (if supported).

For fine-grained control, use an Engine with explicit options:

```ts
import { createEngine } from 'safexpr';

const engine = createEngine({
  maxExpressionLength: 2000,
  maxAstDepth: 64,
  maxEvalOperations: 10_000,
});

const expr = engine.compile<{ x: number }, number>('(x + 1) * 2');
```

> These options are **not required** to use `compile`, but they define what
> “safe defaults” should look like internally.

---

## When to use `compile` vs `createEngine`

Use **`compile`** when:

* you have a small number of expressions;
* you don’t need custom functions or plugins;
* you want minimal setup.

Use **`createEngine`** when:

* you want to **register reusable functions** (`withFunction`) for expressions;
* you need **multiple expressions** sharing the same configuration;
* you want to customize **limits / security options**;
* you are building higher-level **plugins** (collections, dates, etc.).

The compiled expression object is deliberately the same shape in both cases,
so you can start with `compile` and later move to an Engine with minimal code
changes.

---

## Example: CLI helper

Simple Node script using `compile` for quick rules experiments:

```ts
#!/usr/bin/env node
import { compile } from 'safexpr';

type Ctx = {
  x: number;
  y: number;
};

const [, , expr = 'x + y'] = process.argv;

const compiled = compile<Ctx, unknown>(expr);

const ctx: Ctx = { x: 10, y: 5 };
const result = compiled.eval(ctx);

console.log('Expression:', expr);
console.log('Context:', ctx);
console.log('Result:', result);
```

Run:

```bash
node eval.js "x * y > 40 ? 'big' : 'small'"
```

---

## Summary

* `compile` turns a **string expression** into a **reusable evaluator**.
* It is type-hinted via generics (`<Context, Result>`).
* It is **safe by default** – no access to globals, `eval`, or prototypes.
* It provides **good errors** (`SafexprError`) for syntax & runtime issues.
* For custom functions, limits, and plugins, use an Engine
  (`createEngine().compile(...)`) with the same evaluation interface.

If you need more advanced control or want to extend the language surface,
`compile` is still your base building block – everything else in SafExpr
is built around the same core abstraction.
