# Plugins

SafExpr doesn’t ship with a “plugin system” in the framework sense.  
Instead, it exposes a **simple, composable primitive**:

```ts
import { createEngine } from 'safexpr';

const engine = createEngine().withFunction('name', fn);
````

Everything else — *plugins*, *extensions*, *DSL helpers* — is built on top of
this low-level primitive.

This page shows **recommended patterns** for building plugins:

* What is a plugin in SafExpr?
* How to build and compose them.
* How to test them.
* How to expose them as npm packages or internal modules.

---

## What is a SafExpr plugin?

A **plugin** is just a function that:

* **takes an Engine** instance;
* **registers functions** via `.withFunction(...)`;
* **returns** the (same or new) Engine.

```ts
import { createEngine } from 'safexpr';

type Engine = ReturnType<typeof createEngine>;

function myPlugin(engine: Engine): Engine {
  return engine
    .withFunction('hello', (name: string) => `Hello, ${name}!`)
    .withFunction('len', (s: string) => s.length);
}
```

Usage:

```ts
const engine = myPlugin(createEngine());

const expr = engine.compile<{ name: string }, string>('hello(name)');
expr.eval({ name: 'Alice' }); // "Hello, Alice!"
```

That’s it. No extra API surface, no plugin registry, no global state.

---

## Why plugins?

Plugins solve three recurring problems:

1. **Reuse**: you don’t want to re-register the same functions in every file.
2. **Composition**: different teams/domains can ship their own helper bundles.
3. **Isolation**: each engine instance chooses which plugins to use.

You can treat plugins as **“mini standard libraries”** for SafExpr.

---

## Basic plugin patterns

### 1. Simple plugin (math helpers)

```ts
import { createEngine } from 'safexpr';

type Engine = ReturnType<typeof createEngine>;

export function mathPlugin(engine: Engine): Engine {
  return engine
    .withFunction('abs', (x: number) => (x < 0 ? -x : x))
    .withFunction('round', (x: number) => Math.round(x))
    .withFunction('clamp', (x: number, min: number, max: number) =>
      x < min ? min : x > max ? max : x,
    );
}
```

Usage:

```ts
type Context = { n: number };

const engine = mathPlugin(createEngine());
const expr = engine.compile<Context, number>('clamp(abs(n) * 2, 0, 100)');

expr.eval({ n: -10 }); // 20
```

---

### 2. Collection plugin (arrays / lists)

```ts
type Engine = ReturnType<typeof createEngine>;

export function collectionPlugin(engine: Engine): Engine {
  return engine
    .withFunction('sum', (items: number[]) =>
      items.reduce((acc, n) => acc + n, 0),
    )
    .withFunction('avg', (items: number[]) =>
      items.length === 0 ? 0 : items.reduce((a, b) => a + b, 0) / items.length,
    )
    .withFunction('max', (items: number[]) =>
      items.length === 0 ? null : items.reduce((a, b) => (b > a ? b : a)),
    );
}
```

Usage:

```ts
type Context = { nums: number[] };

const engine = collectionPlugin(createEngine());

const expr = engine.compile<Context, number>('sum(nums) + avg(nums)');
expr.eval({ nums: [1, 2, 3, 4, 5] });
```

> This behavior (e.g. `avg([]) === 0`, `max([]) === null`) is well-defined in
> `tests/unit/plugins.spec.ts` so other code can rely on it.

---

### 3. Configurable plugin (factory pattern)

Sometimes you need **options**:

```ts
type Engine = ReturnType<typeof createEngine>;

type MathPluginOptions = {
  roundResult?: boolean;
};

export function createSafeMathPlugin(options: MathPluginOptions) {
  return function safeMathPlugin(engine: Engine): Engine {
    const roundResult = options.roundResult === true;

    return engine.withFunction('safeDiv', (a: number, b: number) => {
      if (b === 0) return 0;
      const result = a / b;
      return roundResult ? Math.round(result) : result;
    });
  };
}
```

Usage:

```ts
const safeMath = createSafeMathPlugin({ roundResult: true });
const engine = safeMath(createEngine());

type Context = { a: number; b: number };
const expr = engine.compile<Context, number>('safeDiv(a, b)');

expr.eval({ a: 10, b: 3 }); // 3 (rounded)
expr.eval({ a: 10, b: 0 }); // 0 (safe default)
```

---

### 4. Domain plugin (business rules)

Example: user segmentation + pricing helpers.

```ts
type Engine = ReturnType<typeof createEngine>;

export function commercePlugin(engine: Engine): Engine {
  return engine
    .withFunction('segment', (age: number): string =>
      age < 18 ? 'child' : age < 30 ? 'young-adult' : 'adult',
    )
    .withFunction('discountFor', (subtotal: number, premium: boolean): number =>
      premium && subtotal >= 100 ? subtotal * 0.1 : 0,
    )
    .withFunction('round2', (x: number) => Math.round(x * 100) / 100);
}
```

Usage:

```ts
type Context = {
  user: { age: number; premium: boolean };
  order: { subtotal: number; shipping: number; taxRate: number };
};

const engine = commercePlugin(createEngine());

const expr = engine.compile<Context, number>(
  `
  const d = discountFor(order.subtotal, user.premium);
  round2((order.subtotal - d + order.shipping) * (1 + order.taxRate))
  `,
);
```

(If your core language doesn’t support `const`, write the equivalent as a single
expression — the idea is the same.)

---

## Composing plugins

Plugins are **just functions**, so composition is trivial:

```ts
const engine = createEngine();
const withMath = mathPlugin(engine);
const withMathAndCollections = collectionPlugin(withMath);
```

More compact:

```ts
const engine = collectionPlugin(mathPlugin(createEngine()));
```

With configurable plugins:

```ts
const engine = collectionPlugin(
  mathPlugin(
    createSafeMathPlugin({ roundResult: true })(createEngine()),
  ),
);
```

> All of these patterns are exercised in `tests/unit/plugins.spec.ts`.

---

## Testing plugins

Plugins are a **core integration point**, so tests matter.

Recommended structure:

* Put plugin tests in `tests/unit/plugins.spec.ts` (or split by plugin).
* Verify:

  * **Happy path**: functions behave as you expect.
  * **Edge cases**: empty arrays, division by zero, invalid inputs.
  * **Isolation**: engines without plugin do *not* see plugin functions.
  * **Composition**: plugins play nicely together.

Example (from `tests/unit/plugins.spec.ts` style):

```ts
import { describe, it, expect } from 'vitest';
import { createEngine } from 'safexpr';
import { mathPlugin, collectionPlugin } from '../../src/plugins';

type Context = { n: number; nums: number[] };

describe('mathPlugin + collectionPlugin', () => {
  it('composes correctly', () => {
    const engine = collectionPlugin(mathPlugin(createEngine()));
    const expr = engine.compile<Context, number>('clamp(sum(nums), 0, 10) + abs(-n)');

    const result = expr.eval({ n: 3, nums: [1, 2, 3, 4, 5] });
    const sum = [1, 2, 3, 4, 5].reduce((a, b) => a + b, 0);

    expect(result).toBe(Math.max(0, Math.min(10, sum)) + Math.abs(-3));
  });

  it('does not leak helpers to engines without plugin', () => {
    const withPlugin = mathPlugin(createEngine());
    const withoutPlugin = createEngine();

    const okExpr = withPlugin.compile<Context, number>('abs(-n)');
    expect(okExpr.eval({ n: 5, nums: [] })).toBe(5);

    let caught: unknown;
    try {
      const badExpr = withoutPlugin.compile<Context, number>('abs(-n)');
      badExpr.eval({ n: 5, nums: [] });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
  });
});
```

---

## Safety & plugins

A plugin runs **trusted** code. Expressions run **untrusted** code.

* The sandbox boundary is the **expression**; plugin functions are part of the
  **trusted surface** of your app.
* Plugins must treat **arguments as untrusted** (validate, sanitize, etc.).
* SafExpr still blocks:

  * global access (`process`, `window`, `globalThis`, `document`, …);
  * dynamic code (`eval`, `Function`, constructor tricks);
  * prototype escape hatches (e.g. `__proto__`, `constructor.prototype`).

Even with plugins, expressions like these should fail:

```ts
engine.compile('process.env');             // ❌
engine.compile('({}).constructor');        // ❌
engine.compile('user.__proto__');          // ❌
```

See:

* `tests/security/globals-access.spec.ts`
* `tests/security/prototype-pollution.spec.ts`

for detailed expectations.

---

## Publishing plugins

You can publish plugins as standalone packages or internal modules.

### As an npm package

Example structure:

```ts
// src/index.ts
import { createEngine } from 'safexpr';

export type Engine = ReturnType<typeof createEngine>;

export function myOrgPlugin(engine: Engine): Engine {
  return engine
    .withFunction('myFn', () => /* ... */)
    .withFunction('otherFn', () => /* ... */);
}
```

Usage in consumer:

```ts
import { createEngine } from 'safexpr';
import { myOrgPlugin } from '@my-org/safexpr-plugin';

const engine = myOrgPlugin(createEngine());
```

### As internal modules

For mono-repos / single apps, keep plugins in:

* `src/plugins/math.ts`
* `src/plugins/collections.ts`
* `src/plugins/commerce.ts`

and re-export them from a central `src/plugins/index.ts`.

---

## Design guidelines

When designing plugins:

1. **Keep functions small and predictable.**
   Each helper should do one thing, with clear semantics.

2. **Avoid side effects.**
   Plugins are easier to reason about when functions are pure.

3. **Document edge cases.**
   For example: “`avg([])` returns 0” or “`safeDiv(x, 0)` returns 0”.

4. **Use descriptive names.**
   Users will see these names in expressions; make them readable.

5. **Version your behavior.**
   Changing semantics can break stored expressions; consider
   versioned plugins if you expect behavior to evolve.

6. **Leverage TypeScript.**
   Strongly type function parameters and return types; expression
   contexts can then rely on these shapes.

---

## Summary

* SafExpr plugins are **just functions over Engines**:

  * `type Engine = ReturnType<typeof createEngine>;`
  * `function plugin(engine: Engine): Engine { … }`
* They register **helper functions** via `.withFunction(name, fn)`.
* Plugins can be:

  * simple (math, collections),
  * configurable (factory pattern),
  * domain-specific (commerce, risk scoring, segmentation).
* Plugins are **composable, testable, and isolated**:

  * engines without a plugin do not see its helpers.
  * engines with multiple plugins can combine their helpers.
* Plugins live entirely in **userland** — no special API needed beyond
  `createEngine` and `withFunction`.

For concrete, working examples, look at:

* `tests/unit/plugins.spec.ts`
* `tests/unit/engine.spec.ts`
* `examples/basic-node/`
* `examples/react-playground/`
