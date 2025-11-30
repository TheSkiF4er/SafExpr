# SafExpr Overview

SafExpr is a **safe, minimalistic, type-safe user expression engine**  
for JavaScript/TypeScript.

> **Formulas, rules and filters — no `eval`, no access to globals, and a pleasant DX.**

It’s designed for applications that need to evaluate **untrusted** or
user-authored expressions (rules, filters, formulas) without handing them
the keys to your Node.js / browser runtime.

---

## Why SafExpr?

Traditional approaches:

- `eval`, `Function`, or ad-hoc interpreters  
  → **Remote code execution**, access to `process`, filesystem, network…
- Full script languages embedded in your app  
  → too much power, too many footguns, hard to lock down.
- Custom JSON rule formats  
  → verbose, hard to read/write, and often hard to evolve.

SafExpr takes a different approach:

- A **small, predictable, JS-like expression language** (no statements, no
  assignments, no globals).
- A clear **sandbox boundary**: expressions only see:
  - the **context object** you pass, and
  - **trusted helper functions** you explicitly register.
- A clean, **type-friendly TS API** for both small scripts and large apps.
- A test suite that acts as an **executable specification**  
  (including security-focused tests).

---

## Core ideas

### 1. Expressions, not programs

SafExpr works with **expressions** — things that evaluate to a value:

```txt
price * qty
user.age >= 18 && user.country == "US"
user.premium ? "VIP" : "REGULAR"
sum(nums) / (nums.length || 1)
````

There are **no**:

* statements (`if`, `for`, `while`, `return`, …),
* assignments (`=`, `+=`, `++`, …),
* function declarations, classes, or modules.

This keeps the language:

* easy to reason about,
* easy to sandbox,
* easy to embed in UIs.

See: [`docs/guides/expressions-syntax.md`](./guides/expressions-syntax.md).

---

### 2. Context-based evaluation

Every expression is evaluated against a **context object**:

```ts
import { compile } from 'safexpr';

type Context = {
  user: { age: number; country: string; premium: boolean };
  order: { subtotal: number; shipping: number; taxRate: number };
};

const source = `
  user.premium && user.age >= 18
    ? (order.subtotal * 0.9 + order.shipping) * (1 + order.taxRate)
    : (order.subtotal + order.shipping) * (1 + order.taxRate)
`;

const expr = compile<Context, number>(source);

const total = expr.eval({
  user: { age: 27, country: 'US', premium: true },
  order: { subtotal: 150, shipping: 10, taxRate: 0.2 },
});
```

Expressions can **only** read from:

* the context (`user`, `order`, …),
* helper functions you choose to expose.

They cannot reach out to **process**, **filesystem**, **network**, or
global objects unless *you* intentionally route that through helpers.

---

### 3. Safe by default

From inside an expression, users **cannot**:

* access Node/browser globals:

  ```txt
  process        // ❌
  globalThis     // ❌
  window         // ❌
  document       // ❌
  require("fs")  // ❌
  ```

* execute dynamic code:

  ```txt
  eval("1 + 1")                                // ❌
  Function("return process")()                 // ❌
  ({}).constructor.constructor("return this")  // ❌
  ```

* reach or mutate prototypes:

  ```txt
  user.__proto__                      // ❌
  user.constructor                    // ❌
  user.constructor.prototype          // ❌
  payload["__proto__"] = { x: 1 }     // ❌
  payload.constructor.prototype.x = 1 // ❌
  ```

SafExpr’s tokenizer, parser, and evaluator are built to **reject** or
guard these patterns. The security model is codified in:

* `tests/security/globals-access.spec.ts`
* `tests/security/prototype-pollution.spec.ts`
* `tests/security/dos-limits.spec.ts`

See: [`docs/guides/security-model.md`](./guides/security-model.md).

---

### 4. Strong DX & TypeScript support

SafExpr is written in TypeScript and ships with typings:

* **Generics** let you describe the context and result type:

  ```ts
  const expr = compile<{ x: number; y: number }, number>('x * 2 + y');
  const result = expr.eval({ x: 10, y: 5 }); // result: number
  ```

* TypeScript will warn you if:

  * you pass a context with wrong shape,
  * you assume the wrong result type.

* You can build editor tooling, code completion and validation on top of
  the exposed AST (`compiled.ast`).

It also surfaces **good errors** through `SafexprError`:

```ts
try {
  const expr = compile<{ n: number; m: number }, number>('n * * m');
  expr.eval({ n: 1, m: 2 });
} catch (err) {
  if (err instanceof SafexprError) {
    console.error('SafExpr error:', err.message);
    console.error('column:', err.column);
    console.error('snippet:\n' + err.snippet);
  }
}
```

---

### 5. Engines & plugins

SafExpr has two layers:

1. **Top-level `compile`**

   * simplest entry point,
   * great for small scripts, tests, one-off expressions.

2. **Configurable `Engine` via `createEngine`**

   * register reusable helpers with `.withFunction(name, fn)`;
   * set safety limits (DoS protection, depth limits, etc.);
   * compose “plugins” that bundle helpers.

```ts
import { createEngine } from 'safexpr';

type Context = { nums: number[] };

const engine = createEngine()
  .withFunction('sum', (items: number[]) =>
    items.reduce((acc, n) => acc + n, 0),
  )
  .withFunction('avg', (items: number[]) =>
    items.length === 0 ? 0 : items.reduce((a, b) => a + b, 0) / items.length,
  );

const expr = engine.compile<Context, number>('avg(nums) * 2');

expr.eval({ nums: [1, 2, 3, 4, 5] });
```

Plugins are simple functions over Engines:

```ts
type Engine = ReturnType<typeof createEngine>;

function mathPlugin(engine: Engine): Engine {
  return engine
    .withFunction('abs', (x: number) => (x < 0 ? -x : x))
    .withFunction('clamp', (x: number, min: number, max: number) =>
      x < min ? min : x > max ? max : x,
    );
}

const engineWithPlugins = mathPlugin(createEngine());
```

See:

* [`docs/api/engine.md`](./api/engine.md)
* [`docs/api/plugins.md`](./api/plugins.md)
* `tests/unit/plugins.spec.ts`

---

## Key features at a glance

* ✅ **Safe by default**

  * No `eval`, no globals, no prototype tricks.
* ✅ **Minimal, JS-like expression syntax**

  * Arithmetic, logical operators, comparisons, ternaries, nullish `??`, arrays,
    member access, and function calls.
* ✅ **Type-friendly API**

  * Generics for context and result; great editor experience.
* ✅ **Composable engines & plugins**

  * Build your own helper libraries; share them across projects.
* ✅ **DoS protection (aspirational)**

  * `maxExpressionLength`, `maxAstDepth`, `maxEvalOperations`.
* ✅ **Good errors**

  * `SafexprError` with column + snippet for IDEs and UIs.
* ✅ **Tested security model**

  * Dedicated `security/` test suite acts as documentation.

---

## Typical use cases

SafExpr is a good fit when you want non-engineers, admins, or tenants to define
logic, but you don’t want them to run arbitrary JS.

Examples:

* **Business rules & workflows**

  * eligibility checks, routing, “if X then Y” logic.
* **Feature flags / rollouts**

  * `user.country == "US" && user.plan != "free"`.
* **Pricing & discounts**

  * dynamic discounts, surcharges, tax rules.
* **Validation & filters**

  * query-like expressions for selecting users / rows / events.
* **Dashboards & analytics**

  * computed fields, derived metrics.
* **Configuration-driven behavior**

  * behavior tweaked from DB or config files, not code.

See the cookbook: [`docs/examples.md`](./examples.md).

---

## High-level architecture

The repository (suggested structure):

```txt
SafExpr/
  src/
    tokenizer/        # turn source into tokens
    parser/           # turn tokens into AST
    evaluator/        # evaluate AST against context safely
    engine/           # createEngine, withFunction, options
    compile.ts        # top-level compile() helper
    errors.ts         # SafexprError, diagnostics
  tests/
    unit/
      engine.spec.ts
      evaluator.spec.ts
      parser.spec.ts
      tokenizer.spec.ts
      plugins.spec.ts
    integration/
      syntax-cases.spec.ts
      complex-rules.spec.ts
    security/
      globals-access.spec.ts
      prototype-pollution.spec.ts
      dos-limits.spec.ts
  examples/
    basic-node/
    react-playground/
  docs/
    api/
      compile.md
      engine.md
      plugins.md
    guides/
      expressions-syntax.md
      migration-guide.md
      security-model.md
    examples.md
    getting-started.md
    overview.md      # (this file)
```

You don’t have to follow this layout exactly, but the tests and docs assume a
similar split between **core**, **security**, and **DX** concerns.

---

## Migration from existing systems

If you currently use:

* `eval` / `Function`,
* ad-hoc mini interpreters,
* JSON-based rule systems (e.g. JSON Logic),
* other JavaScript-like expression engines,

SafExpr aims to give you a **safer** and **cleaner** alternative.

Key migration steps:

1. **Model your context** as TypeScript types.
2. **Create an Engine** and register any helpers you need.
3. **Map existing expressions** to SafExpr syntax (usually a small delta).
4. Run both old and new systems in **shadow mode** for a while.
5. Turn off `eval` / legacy engine once you’re confident.

See: [`docs/guides/migration-guide.md`](./guides/migration-guide.md).

---

## Security model in one paragraph

* Expressions are **untrusted**.
* Helpers (registered via `withFunction`) and your host application are
  **trusted**.
* Expressions only have access to:

  * the **context** you provide, and
  * helpers you explicitly expose.
* SafExpr blocks:

  * Node/browser globals,
  * dynamic code execution primitives,
  * prototype access / mutation,
  * syntax that is hard to sandbox (statements, assignments, etc.).
* Engines can enforce additional **resource limits** (length, depth, operations).

Full details: [`docs/guides/security-model.md`](./guides/security-model.md).

---

## Where to go next

* **Just want to use it?**

  * Start with [`docs/getting-started.md`](./getting-started.md).

* **Want to know exactly what you can write inside expressions?**

  * Read [`docs/guides/expressions-syntax.md`](./guides/expressions-syntax.md).

* **Building a serious rules system?**

  * Check [`docs/api/engine.md`](./api/engine.md),
    [`docs/api/plugins.md`](./api/plugins.md),
    and the cookbook [`docs/examples.md`](./examples.md).

* **Caring about security (you should)?**

  * Study [`docs/guides/security-model.md`](./guides/security-model.md)
    and the tests in `tests/security/`.

SafExpr’s philosophy is simple:

> **Make the safe thing the easy thing.**
> Small, understandable expression language. Clear APIs. Strong tests.
> No `eval`. No globals. No surprises.
