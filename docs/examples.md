# Examples

This page is a **cookbook** of SafExpr usage patterns:

- Basic “hello expression” examples.
- Validations, filters, scoring.
- Pricing & discount scenarios.
- Feature flags and A/B testing.
- Node.js scripts & CLIs.
- React playground integrations.
- Error handling and security gotchas.

All examples assume SafExpr is available as:

```ts
import { compile, createEngine, SafexprError } from 'safexpr';
````

Adjust import paths as needed (e.g. `../../src` inside this repo).

---

## 1. Basics

### 1.1. Simple arithmetic

```ts
type Ctx = {
  price: number;
  qty: number;
};

const expr = compile<Ctx, number>('price * qty');

expr.eval({ price: 19.99, qty: 3 }); // 59.97
expr.eval({ price: 5, qty: 10 });    // 50
```

---

### 1.2. Accessing nested properties

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

type Ctx = { user: User; order: Order };

const expr = compile<Ctx, number>(
  `
  user.premium && user.age >= 18
    ? (order.subtotal * 0.9 + order.shipping) * (1 + order.taxRate)
    : (order.subtotal + order.shipping) * (1 + order.taxRate)
  `,
);

expr.eval({
  user: { age: 27, country: 'US', premium: true },
  order: { subtotal: 150, shipping: 10, taxRate: 0.2 },
});
```

---

### 1.3. Using arrays

```ts
type Ctx = { scores: number[] };

const expr = compile<Ctx, number>('scores[0] * 2 + scores[1]');

expr.eval({ scores: [10, 5, 1] }); // (10 * 2) + 5 = 25
```

---

## 2. Validation & filters

### 2.1. Simple object validation

```ts
type User = {
  age: number;
  email: string;
  country: string;
};

type Ctx = { user: User };

const isValid = compile<Ctx, boolean>(
  `
  user.age >= 18 &&
  user.country == "US" &&
  user.email != null &&
  user.email != ""
  `,
);

// later…
isValid.eval({ user: { age: 21, email: 'a@b.com', country: 'US' } }); // true
```

---

### 2.2. Filtering a collection

```ts
type User = {
  id: string;
  age: number;
  country: string;
  premium: boolean;
};

type FilterCtx = { user: User };

const filterExpr = compile<FilterCtx, boolean>(
  `
  user.age >= 18 &&
  user.country == "US" &&
  user.premium == true
  `,
);

const users: User[] = [
  { id: 'u1', age: 17, country: 'US', premium: true },
  { id: 'u2', age: 21, country: 'US', premium: true },
  { id: 'u3', age: 30, country: 'DE', premium: true },
];

const filtered = users.filter((user) => filterExpr.eval({ user }));
// → only u2
```

---

### 2.3. Multi-field form validation

```ts
type Form = {
  email: string | null;
  password: string | null;
  confirmPassword: string | null;
  acceptedTerms: boolean;
};

type Ctx = { form: Form };

const expr = compile<Ctx, boolean>(
  `
  form.email != null &&
  form.email != ""   &&
  form.password != null &&
  form.password == form.confirmPassword &&
  form.acceptedTerms == true
  `,
);

expr.eval({ form: { /* … */ } });
```

You can combine this with custom functions (e.g. `isEmail`, `minLength`) via
`createEngine().withFunction(...)`.

---

## 3. Scoring & ranking

### 3.1. Risk score

```ts
type Applicant = {
  age: number;
  country: string;
  income: number;
  bankruptcies: number;
};

type Ctx = { a: Applicant };

const scoreExpr = compile<Ctx, number>(
  `
  (a.income / 1000)
    - a.bankruptcies * 20
    + (a.age < 25 ? -10 : 0)
    + (a.country == "US" ? 5 : 0)
  `,
);

const score = scoreExpr.eval({
  a: {
    age: 22,
    country: 'US',
    income: 50000,
    bankruptcies: 1,
  },
});
```

You can then interpret the score elsewhere (e.g. risk categories).

---

### 3.2. Multi-criteria product ranking

```ts
type Product = {
  price: number;
  rating: number; // 0–5
  stock: number;
};

type Ctx = { p: Product };

const rankingExpr = compile<Ctx, number>(
  `
  (p.rating * 10)
    - (p.price / 10)
    + (p.stock > 0 ? 5 : -20)
  `,
);

const products: Product[] = [ /* … */ ];

const ranked = products
  .map((p) => ({
    product: p,
    score: rankingExpr.eval({ p }),
  }))
  .sort((a, b) => b.score - a.score);
```

---

## 4. Pricing & discount rules

### 4.1. Engine helpers for discounts

```ts
import { createEngine } from 'safexpr';

type User = {
  id: string;
  premium: boolean;
};

type Order = {
  subtotal: number;
  shipping: number;
  taxRate: number;
};

type Ctx = { user: User; order: Order };

const engine = createEngine()
  .withFunction('discountFor', (subtotal: number, premium: boolean) => {
    if (!premium) return 0;
    if (subtotal >= 200) return subtotal * 0.2;
    if (subtotal >= 100) return subtotal * 0.12;
    return 0;
  })
  .withFunction('round2', (n: number) => Math.round(n * 100) / 100);

const totalExpr = engine.compile<Ctx, number>(
  `
  round2(
    (order.subtotal - discountFor(order.subtotal, user.premium) + order.shipping)
    * (1 + order.taxRate)
  )
  `,
);
```

Usage:

```ts
const total = totalExpr.eval({
  user: { id: 'u1', premium: true },
  order: { subtotal: 150, shipping: 10, taxRate: 0.2 },
});
```

---

### 4.2. Coupon rules

```ts
type Coupon = {
  code: string;
  enabled: boolean;
  minSubtotal: number;
  allowedCountries: string[];
};

type Ctx = {
  coupon: Coupon;
  user: { country: string };
  order: { subtotal: number };
};

const engine = createEngine().withFunction(
  'contains',
  (arr: string[], val: string) => arr.includes(val),
);

const couponApplicableExpr = engine.compile<Ctx, boolean>(
  `
  coupon.enabled == true &&
  order.subtotal >= coupon.minSubtotal &&
  contains(coupon.allowedCountries, user.country)
  `,
);
```

---

## 5. Feature flags & rollout rules

### 5.1. Simple flag rule

```ts
type Ctx = {
  user: {
    id: string;
    country: string;
    plan: 'free' | 'pro' | 'enterprise';
  };
};

const expr = compile<Ctx, boolean>(
  `
  user.country == "US" &&
  (user.plan == "pro" || user.plan == "enterprise")
  `,
);

// somewhere in flag evaluation:
if (expr.eval({ user })) {
  enableFeature();
}
```

---

### 5.2. Percentage-based rollout

Use a deterministic hash function in a helper (trusted code), not inside
expressions:

```ts
import { createHash } from 'crypto';

function bucketForUser(userId: string): number {
  const h = createHash('sha1').update(userId).digest('hex');
  const first4 = h.slice(0, 4); // 16-bit-ish
  const val = parseInt(first4, 16);
  return (val % 100) + 1; // 1..100
}

const engine = createEngine().withFunction('bucket', bucketForUser);

type Ctx = {
  user: { id: string; country: string };
};

const rolloutExpr = engine.compile<Ctx, boolean>(
  `
  bucket(user.id) <= 20 && user.country == "US"
  `,
);

// → feature active for ~20% of US users
```

---

## 6. Node.js scripts & CLIs

### 6.1. Simple CLI evaluator

File: `scripts/eval-rule.ts`

```ts
#!/usr/bin/env node
import { compile } from 'safexpr';

type Ctx = { x: number; y: number };

async function main() {
  const [, , expr = 'x + y'] = process.argv;

  const compiled = compile<Ctx, unknown>(expr);
  const ctx: Ctx = { x: 10, y: 5 };

  const result = compiled.eval(ctx);

  console.log('Expression:', expr);
  console.log('Context   :', ctx);
  console.log('Result    :', result);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

Run:

```bash
node scripts/eval-rule.js "x * 2 + y"
```

---

### 6.2. Pre-compiling from configuration

```ts
import { createEngine } from 'safexpr';

type Ctx = { user: { age: number; premium: boolean } };

const engine = createEngine();

// Suppose this comes from a config file or DB:
const rawRules = {
  allow: 'user.age >= 18 && user.premium == true',
  label: 'user.premium ? "VIP" : "REGULAR"',
};

const compiledRules = {
  allow: engine.compile<Ctx, boolean>(rawRules.allow),
  label: engine.compile<Ctx, string>(rawRules.label),
};

// later…
const ctx: Ctx = { user: { age: 21, premium: true } };

if (compiledRules.allow.eval(ctx)) {
  console.log(compiledRules.label.eval(ctx)); // "VIP"
}
```

---

## 7. React / UI integration

### 7.1. Basic React expression playground

This mirrors `examples/react-playground/src/App.tsx` (conceptually):

```tsx
import React, { useState } from 'react';
import { compile, SafexprError } from 'safexpr';

type Ctx = {
  price: number;
  qty: number;
};

export function App() {
  const [expression, setExpression] = useState('price * qty');
  const [ctxJson, setCtxJson] = useState('{"price": 10, "qty": 2}');
  const [output, setOutput] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = () => {
    try {
      setError(null);
      setOutput(null);

      const ctx = JSON.parse(ctxJson) as Ctx;
      const compiled = compile<Ctx, unknown>(expression);
      const result = compiled.eval(ctx);

      setOutput(JSON.stringify(result, null, 2));
    } catch (err) {
      if (err instanceof SafexprError) {
        setError(
          `SafExpr error: ${err.message}\ncolumn: ${err.column}\nsnippet:\n${err.snippet}`,
        );
      } else if (err instanceof SyntaxError) {
        setError(`JSON error: ${(err as Error).message}`);
      } else {
        setError(`Unexpected error: ${(err as Error).message}`);
      }
    }
  };

  return (
    <div style={{ fontFamily: 'system-ui', padding: 16 }}>
      <h1>SafExpr Playground</h1>

      <label>
        Expression
        <textarea
          value={expression}
          onChange={(e) => setExpression(e.target.value)}
          rows={3}
          style={{ width: '100%' }}
        />
      </label>

      <label>
        Context (JSON)
        <textarea
          value={ctxJson}
          onChange={(e) => setCtxJson(e.target.value)}
          rows={4}
          style={{ width: '100%' }}
        />
      </label>

      <button onClick={run}>Run</button>

      {output && (
        <pre style={{ background: '#111', color: '#0f0', padding: 8 }}>
          {output}
        </pre>
      )}

      {error && (
        <pre style={{ background: '#300', color: '#f99', padding: 8 }}>
          {error}
        </pre>
      )}
    </div>
  );
}
```

---

## 8. Error handling patterns

### 8.1. Distinguishing SafexprError

```ts
import { compile, SafexprError } from 'safexpr';

type Ctx = { n: number; m: number };

const expr = 'n * * m'; // invalid

try {
  const compiled = compile<Ctx, number>(expr);
  compiled.eval({ n: 1, m: 2 });
} catch (err) {
  if (err instanceof SafexprError) {
    console.error('SafExpr syntax/runtime error:');
    console.error('message:', err.message);
    console.error('column :', err.column);
    console.error('snippet:', err.snippet);
  } else {
    console.error('Unexpected error:', err);
  }
}
```

---

### 8.2. Wrapping evaluation in a helper

```ts
import { createEngine, SafexprError } from 'safexpr';

type Ctx = { [key: string]: unknown };

const engine = createEngine();

export function safeEval<Context extends Ctx, Result>(
  expression: string,
  ctx: Context,
): { ok: true; value: Result } | { ok: false; error: string } {
  try {
    const compiled = engine.compile<Context, Result>(expression);
    const value = compiled.eval(ctx);
    return { ok: true, value };
  } catch (err) {
    if (err instanceof SafexprError) {
      return {
        ok: false,
        error: `SafExpr error: ${err.message} (col ${err.column})`,
      };
    }
    return { ok: false, error: `Unexpected error: ${(err as Error).message}` };
  }
}
```

---

## 9. Security-focused examples

### 9.1. Blocking globals

These must fail (by design):

```ts
const badExpressions = [
  'process',
  'globalThis',
  'window',
  '({}).constructor.constructor("return process")()',
];

for (const source of badExpressions) {
  try {
    const compiled = compile<Record<string, unknown>, unknown>(source);
    compiled.eval({});
    console.error('UNEXPECTED: expression should have failed', source);
  } catch (err) {
    console.log('OK (blocked):', source);
  }
}
```

See `tests/security/globals-access.spec.ts` for detailed behavior.

---

### 9.2. Prototype pollution attempts

```ts
const dangerous = [
  'obj.__proto__',
  'obj.constructor',
  'obj.constructor.prototype',
  'obj["__proto__"] = { polluted: "yes" }',
];

type Ctx = { obj: Record<string, unknown> };

for (const source of dangerous) {
  try {
    const compiled = compile<Ctx, unknown>(source);
    compiled.eval({ obj: {} });
    console.error('UNEXPECTED: expression should have failed', source);
  } catch (err) {
    console.log('OK (blocked)', source);
  }
}
```

See `tests/security/prototype-pollution.spec.ts`.

---

### 9.3. DoS protections with engine options

```ts
import { createEngine } from 'safexpr';

const engine = createEngine({
  maxExpressionLength: 2_000,
  maxAstDepth: 64,
  maxEvalOperations: 10_000,
});

function buildLongExpression(count: number): string {
  return Array.from({ length: count }, () => '1').join(' + ');
}

const okExpr = buildLongExpression(100);
const tooLong = buildLongExpression(10_000);

engine.compile<Record<string, never>, number>(okExpr); // ✅ should work

try {
  engine.compile<Record<string, never>, number>(tooLong); // ❌ should fail
  console.error('UNEXPECTED: long expression compiled');
} catch {
  console.log('OK: long expression rejected');
}
```

---

## 10. Putting it all together: mini rule engine

A compact “pattern” you’ll see in real projects.

```ts
import { createEngine, SafexprError } from 'safexpr';

export type RuleContext = {
  user: {
    id: string;
    age: number;
    country: string;
    premium: boolean;
    tags: string[];
  };
  order: {
    subtotal: number;
    shipping: number;
    taxRate: number;
  };
};

export type CompiledRule = {
  name: string;
  source: string;
  eval(ctx: RuleContext): boolean;
};

const engine = createEngine()
  .withFunction('hasTag', (tags: string[], tag: string) => tags.includes(tag))
  .withFunction(
    'segment',
    (age: number): string =>
      age < 18 ? 'child' : age < 30 ? 'young-adult' : 'adult',
  );

// Compile rules from config / DB:
export function compileRules(
  sources: Array<{ name: string; source: string }>,
): CompiledRule[] {
  return sources.map(({ name, source }) => {
    const compiled = engine.compile<RuleContext, boolean>(source);
    return {
      name,
      source,
      eval: (ctx) => compiled.eval(ctx),
    };
  });
}

// Evaluate rules against a context and collect those that pass:
export function evaluateRules(
  rules: CompiledRule[],
  ctx: RuleContext,
): string[] {
  const passed: string[] = [];

  for (const rule of rules) {
    try {
      if (rule.eval(ctx)) {
        passed.push(rule.name);
      }
    } catch (err) {
      if (err instanceof SafexprError) {
        console.error(
          `Rule "${rule.name}" failed: ${err.message} (col ${err.column})`,
        );
      } else {
        console.error(`Rule "${rule.name}" unexpected error:`, err);
      }
    }
  }

  return passed;
}
```

Example configuration:

```ts
const rawRules = [
  {
    name: 'premium-us',
    source: 'user.country == "US" && user.premium == true',
  },
  {
    name: 'young-beta',
    source:
      'segment(user.age) == "young-adult" && hasTag(user.tags, "beta-tester")',
  },
  {
    name: 'high-value',
    source: 'order.subtotal >= 200',
  },
];

const rules = compileRules(rawRules);

const context: RuleContext = {
  user: {
    id: 'u1',
    age: 24,
    country: 'US',
    premium: true,
    tags: ['beta-tester'],
  },
  order: { subtotal: 250, shipping: 10, taxRate: 0.2 },
};

const matched = evaluateRules(rules, context);
// e.g. ["premium-us", "young-beta", "high-value"]
```

---

## 11. Next steps

* Learn the **syntax** in detail:
  [`docs/guides/expressions-syntax.md`](./guides/expressions-syntax.md)
* Explore the **API**:

  * [`docs/api/compile.md`](./api/compile.md)
  * [`docs/api/engine.md`](./api/engine.md)
  * [`docs/api/plugins.md`](./api/plugins.md)
* Study the **tests as documentation**:

  * `tests/unit/evaluator.spec.ts`
  * `tests/unit/engine.spec.ts`
  * `tests/unit/plugins.spec.ts`
  * `tests/security/*.spec.ts`
* Try the **examples**:

  * `examples/basic-node/`
  * `examples/react-playground/`

Use this file as a template library: copy, adapt, and evolve these patterns
for your own SafExpr-based rules, filters, and engines.
