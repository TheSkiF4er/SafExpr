# `createEngine` (SafExpr Engine)

The **Engine** is the “power user” entry point of SafExpr.

Where [`compile`](./compile.md) is perfect for one-off expressions,  
`createEngine` is designed for **shared configuration**:

- custom helper **functions** (via `.withFunction(...)`);
- reusable **expression compilation** (`engine.compile(...)`);
- optional **limits & safety options** (DoS protection, nesting limits, etc.);
- composable **plugins** that register groups of helpers.

```ts
import { createEngine } from 'safexpr';
````

---

## Quick overview

```ts
import { createEngine } from 'safexpr';

type Context = {
  user: { age: number; premium: boolean };
  order: { subtotal: number; shipping: number; taxRate: number };
};

// 1. Create an engine with reusable helpers
const engine = createEngine()
  .withFunction('discount', (subtotal: number, premium: boolean) =>
    premium && subtotal >= 100 ? subtotal * 0.1 : 0,
  )
  .withFunction('round2', (n: number) => Math.round(n * 100) / 100);

// 2. Compile expressions once, reuse many times
const totalExpr = engine.compile<Context, number>(
  `
  const d = discount(order.subtotal, user.premium);
  round2((order.subtotal - d + order.shipping) * (1 + order.taxRate))
  `,
);

// 3. Evaluate with different contexts
const total = totalExpr.eval({
  user: { age: 27, premium: true },
  order: { subtotal: 150, shipping: 10, taxRate: 0.2 },
});
```

> The exact language extensions like `const` or assignment are **implementation-specific**.
> In a minimal core, you would write the equivalent directly as a single expression.

---

## Signature

```ts
declare function createEngine(options?: EngineOptions): Engine;
```

### `EngineOptions` (aspirational spec)

All options are **optional**. SafExpr chooses safe defaults when omitted.

```ts
type EngineOptions = {
  /** Max allowed length of the expression source (in characters). */
  maxExpressionLength?: number;

  /** Max allowed AST depth (nesting of parentheses, ternaries, etc.). */
  maxAstDepth?: number;

  /**
   * Max allowed number of evaluation "steps".
   * Interpretation is implementation-specific but should upper-bound work.
   */
  maxEvalOperations?: number;

  /**
   * (Aspirational) Optional control over dangerous keys:
   * "__proto__", "constructor", "prototype", etc.
   */
  dangerousKeys?: string[];

  /** (Aspirational) If true, reject access to dangerous keys. */
  disallowDangerousKeys?: boolean;

  /**
   * (Strongly discouraged in production)
   * Whether globals like `globalThis` / `process` can be referenced.
   * Defaults to false.
   */
  allowUnsafeGlobalAccess?: boolean;
};
```

> These options are used heavily in the test suite (see `tests/security/*.spec.ts`)
> and act as a **spec** for how a robust engine should behave.

---

## `Engine` interface

```ts
type Engine = {
  /**
   * Register a custom function available to expressions compiled from this engine.
   * Returns a *new* Engine with the function added (or the same engine instance,
   * depending on implementation).
   */
  withFunction(name: string, fn: (...args: any[]) => any): Engine;

  /**
   * Compile an expression string into a reusable compiled expression.
   * Behaviour mirrors top-level `compile()`, but using this engine's
   * configuration and function set.
   */
  compile<Context, Result = unknown>(
    source: string,
  ): CompiledExpression<Context, Result>;
};
```

Where `CompiledExpression` is the same shape as described in [`compile.md`](./compile.md):

```ts
type CompiledExpression<Context, Result> = {
  eval(ctx: Context): Result;
  source: string;
  ast?: unknown;
};
```

---

## `withFunction(name, fn)`

`withFunction` lets you expose **trusted helpers** to untrusted expressions.

```ts
const engine = createEngine()
  .withFunction('max', (a: number, b: number) => Math.max(a, b))
  .withFunction('segment', (age: number) =>
    age < 18 ? 'child' : age < 30 ? 'young-adult' : 'adult',
  );
```

### Usage from expressions

```ts
type Context = { user: { age: number }; score: number };

const expr = engine.compile<Context, string>(
  `
  segment(user.age) == "young-adult" && score > 80
    ? "high-potential"
    : "regular"
  `,
);

expr.eval({ user: { age: 24 }, score: 95 }); // "high-potential"
```

### Best practices for `withFunction`

* **Pure & deterministic** – avoid hidden global state if possible.
* **Validate inputs** – treat expression arguments as untrusted data.
* **Throw normal errors** – SafExpr can wrap or propagate them for diagnostics.
* **Avoid returning huge objects** – keep evaluation cheap.

---

## `engine.compile(source)`

`engine.compile` has the **same semantics** as the top-level `compile`, but:

* uses the engine’s **function registry** (`withFunction`);
* uses the engine’s **safety options / limits**;
* can be used to implement **plugins** (bundles of helpers).

```ts
type Ctx = { a: number; b: number };

const engine = createEngine()
  .withFunction('inc', (n: number) => n + 1)
  .withFunction('mul', (a: number, b: number) => a * b);

const expr = engine.compile<Ctx, number>('inc(mul(a, b))');

expr.eval({ a: 2, b: 3 }); // 7
expr.eval({ a: 4, b: 10 }); // 41
```

---

## Sharing an Engine across many expressions

The typical pattern is:

1. Construct an engine once (at startup);
2. Register all reusable helpers (& optional plugins);
3. Compile many expressions from that engine;
4. Reuse compiled expressions & engine across requests.

```ts
// engine.ts
import { createEngine } from 'safexpr';

export const engine = createEngine()
  .withFunction('discount', (subtotal: number, premium: boolean) =>
    premium && subtotal >= 100 ? subtotal * 0.1 : 0,
  )
  .withFunction('round2', (n: number) => Math.round(n * 100) / 100);
```

```ts
// rules.ts
import { engine } from './engine';

type Context = {
  user: { premium: boolean };
  order: { subtotal: number; shipping: number; taxRate: number };
};

export const totalExpr = engine.compile<Context, number>(
  'round2((order.subtotal - discount(order.subtotal, user.premium) + order.shipping) * (1 + order.taxRate))',
);

export const labelExpr = engine.compile<Context, string>(
  'user.premium ? "VIP" : "REGULAR"',
);
```

---

## Plugins on top of `createEngine`

The Engine API is intentionally minimal so you can build **userland plugins**.

### Example: math + collections plugin

```ts
import { createEngine } from 'safexpr';

type Engine = ReturnType<typeof createEngine>;

function mathPlugin(engine: Engine): Engine {
  return engine
    .withFunction('abs', (x: number) => (x < 0 ? -x : x))
    .withFunction('clamp', (x: number, min: number, max: number) =>
      x < min ? min : x > max ? max : x,
    );
}

function collectionPlugin(engine: Engine): Engine {
  return engine
    .withFunction('sum', (items: number[]) => items.reduce((a, b) => a + b, 0))
    .withFunction('avg', (items: number[]) =>
      items.length === 0 ? 0 : items.reduce((a, b) => a + b, 0) / items.length,
    );
}

// Compose plugins:
const engine = collectionPlugin(mathPlugin(createEngine()));
```

Use from expressions:

```ts
type Context = { nums: number[] };

const expr = engine.compile<Context, number>(
  'clamp(sum(nums) / 2, 0, 100)',
);

expr.eval({ nums: [1, 2, 3, 4] });
```

See `tests/unit/plugins.spec.ts` for more patterns.

---

## Limits & DoS protection

The Engine can optionally enforce limits against **pathological expressions**:

* extremely **long** source strings (`maxExpressionLength`);
* very **deep** nesting (`maxAstDepth`);
* huge amounts of work (`maxEvalOperations`).

Example (aspirational):

```ts
import { createEngine } from 'safexpr';

const engine = createEngine({
  maxExpressionLength: 2000,
  maxAstDepth: 64,
  maxEvalOperations: 10_000,
});

const safeExpr = engine.compile<{ x: number }, number>('(x + 1) * 2');
safeExpr.eval({ x: 5 });
```

Behavior for violations:

* **Compile-time failure** for size / depth problems — throw `SafexprError` or a similar error;
* **Runtime failure** when `maxEvalOperations` is exceeded — throw a clear error.

The test files `tests/security/dos-limits.spec.ts` and `tests/security/*.spec.ts`
describe the expected semantics in detail.

---

## Global isolation & security

Engines maintain the same **sandbox** model as `compile`:

* Expressions only see the **context** object and **registered functions**.
* Expressions **cannot** access:

  * `globalThis`, `global`, `window`, `process`, `require`, etc.;
  * `eval`, `Function`, or constructor escape patterns;
  * dangerous prototype entries like `__proto__`, `constructor`, `.prototype`.

Bad expressions that must fail:

```ts
engine.compile('process.env');                // ❌
engine.compile('globalThis');                 // ❌
engine.compile('({}).constructor.constructor("return process")()'); // ❌
engine.compile('user.__proto__');             // ❌
```

All this is tested in:

* `tests/security/globals-access.spec.ts`
* `tests/security/prototype-pollution.spec.ts`

If you expose **trusted** helpers via `withFunction`, those functions can do
anything (they run in normal JS), so they are part of your **trusted surface**.
The sandbox boundary is the expression, not your helper code.

---

## Error handling (`SafexprError` and others)

Both `engine.compile(...)` and `compiled.eval(...)` can throw:

* **`SafexprError`** — syntax errors, disallowed constructs, limit violations,
  or expression-time errors wrapped for better DX;
* **Your own errors** — thrown directly from custom functions registered with
  `withFunction`.

### Basic pattern

```ts
import { createEngine, SafexprError } from 'safexpr';

const engine = createEngine().withFunction('boom', () => {
  throw new Error('plugin blew up');
});

const expr = engine.compile<Record<string, unknown>, unknown>('boom()');

try {
  expr.eval({});
} catch (err) {
  if (err instanceof SafexprError) {
    console.error('SafExpr error:', err.message);
    console.error('column:', err.column);
    console.error('snippet:', err.snippet);
  } else {
    console.error('Underlying error:', err);
  }
}
```

---

## Choosing between Engine and `compile`

Use **Engine** when you:

* want **custom reusable functions** (`withFunction`);
* need **many expressions** sharing the same behavior & limits;
* want to build or consume **plugins**;
* are designing a rule engine / workflow system / feature flags, etc.

Use **`compile`** when you:

* have very few expressions;
* don’t need helpers or shared settings;
* are writing quick scripts or one-off tools.

The good news: the compiled object returned by both is the same shape (`eval`,
`source`, optional `ast`), so **migrating** between them is usually
just replacing:

```ts
const compiled = compile<Ctx, R>(expr);
```

with:

```ts
const engine = createEngine(/* options */);
const compiled = engine.compile<Ctx, R>(expr);
```

---

## Summary

* `createEngine(options?)` creates a **configurable expression engine**.
* `engine.withFunction(name, fn)` registers **trusted helpers**.
* `engine.compile(source)` compiles expressions with all registered helpers
  and safety limits applied.
* Engines are ideal for:

  * multi-expression systems,
  * domain-specific plugins,
  * security-aware deployments.
* The same **sandbox** rules as `compile` apply: no global access, no `eval`,
  no prototype tricks.

For concrete examples, see:

* `examples/basic-node/`
* `examples/react-playground/`
* `tests/unit/engine.spec.ts`
* `tests/unit/plugins.spec.ts`
* `tests/security/*.spec.ts`
