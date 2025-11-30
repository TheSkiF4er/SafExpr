/**
 * SafExpr/examples/basic-node/index.ts
 *
 * Minimal but realistic Node.js example showing how to:
 *  - Define a typed context.
 *  - Compile and evaluate an expression string.
 *  - Use a shared Engine with custom functions.
 *  - Handle errors in a user-friendly way.
 *
 * How to run (from repo root):
 *   1) Build the library:
 *        npm run build
 *   2) Run this example with ts-node or tsx:
 *        npx ts-node examples/basic-node/index.ts
 *        # or
 *        npx tsx examples/basic-node/index.ts
 *
 * After publishing to npm, you would typically:
 *   - Install safexpr in another project:
 *       npm install safexpr
 *   - And then:
 *       import { compile, createEngine, SafexprError } from 'safexpr';
 */

import { compile, createEngine, SafexprError } from '../../src'; // change to 'safexpr' in external projects

// 1. Define your context types

type User = {
  id: string;
  age: number;
  country: string;
  premium: boolean;
};

type Order = {
  id: string;
  subtotal: number;
  shipping: number;
  taxRate: number; // e.g. 0.2 = 20%
};

type Context = {
  user: User;
  order: Order;
};

/**
 * Example expression:
 *
 * - Gives a 10% discount if user is premium AND order subtotal >= 100
 * - Calculates final total with discount and tax
 *
 * In plain English:
 *   if user is premium and subtotal >= 100:
 *     discount = subtotal * 0.1
 *   else:
 *     discount = 0
 *
 *   total = (subtotal - discount + shipping) * (1 + taxRate)
 */
const DEFAULT_EXPRESSION =
  '((user.premium && order.subtotal >= 100) ? order.subtotal * 0.1 : 0) as discount, ' +
  '((order.subtotal - discount + order.shipping) * (1 + order.taxRate))';

// Note: the above includes a "pseudo" `discount` assignment just for illustration.
// For a real Safexpr implementation you might instead write something like:
//   '(user.premium && order.subtotal >= 100 ? order.subtotal * 0.1 : 0)'
// and handle intermediate naming in your application code.
//
// For this example, we’ll use a slightly simpler version to keep it clear:

const EXPRESSION =
  '(user.premium && order.subtotal >= 100 ? order.subtotal * 0.1 : 0)'; // discount only

// 2. Build a sample context

const context: Context = {
  user: {
    id: 'user-123',
    age: 27,
    country: 'US',
    premium: true,
  },
  order: {
    id: 'order-456',
    subtotal: 150,
    shipping: 10,
    taxRate: 0.2,
  },
};

// 3. Option 1: quick one-off compilation with `compile`

function runBasicCompile() {
  console.log('=== Basic compile() example ===');
  console.log('Expression:', EXPRESSION);
  console.log('Context:', JSON.stringify(context, null, 2));
  console.log();

  try {
    const compiled = compile<Context, number>(EXPRESSION);
    const discount = compiled.eval(context);

    const total =
      (context.order.subtotal - discount + context.order.shipping) *
      (1 + context.order.taxRate);

    console.log('Computed discount:', discount);
    console.log('Total with discount & tax:', total);
    console.log();
  } catch (err) {
    handleSafexprError(err);
  }
}

// 4. Option 2: use Engine with custom functions

function runEngineExample() {
  console.log('=== Engine + custom functions example ===');

  // Create a shared engine instance
  const engine = createEngine()
    .withFunction('discountForUser', (subtotal: number, premium: boolean) =>
      premium && subtotal >= 100 ? subtotal * 0.1 : 0,
    )
    .withFunction('round2', (value: number) =>
      Math.round(value * 100) / 100,
    );

  // In expressions we can now call `discountForUser` and `round2`
  const expression =
    'round2((order.subtotal - discountForUser(order.subtotal, user.premium) + order.shipping) * (1 + order.taxRate))';

  console.log('Expression:', expression);
  console.log();

  try {
    const compiled = engine.compile<Context, number>(expression);
    const total = compiled.eval(context);

    console.log('Final rounded total:', total);
    console.log();
  } catch (err) {
    handleSafexprError(err);
  }
}

// 5. CLI: allow overriding the expression via command line argument

function runWithCliExpression() {
  const [, , ...args] = process.argv;
  const cliExpression = args.join(' ');

  if (!cliExpression) {
    console.log('No CLI expression provided, skipping CLI example.\n');
    console.log(
      'You can try: npx ts-node examples/basic-node/index.ts "order.subtotal * 2 + (user.premium ? 10 : 0)"',
    );
    console.log();
    return;
  }

  console.log('=== CLI expression example ===');
  console.log('Expression from CLI:', cliExpression);
  console.log();

  try {
    const compiled = compile<Context, unknown>(cliExpression);
    const result = compiled.eval(context);

    console.log('Result:', result);
    console.log();
  } catch (err) {
    handleSafexprError(err);
  }
}

// 6. Unified error handler

function handleSafexprError(err: unknown) {
  if (err instanceof SafexprError) {
    console.error('Safexpr error:');
    console.error('  message:', err.message);
    console.error('  column :', err.column);
    console.error('  snippet:', err.snippet);
    console.error();
  } else {
    console.error('Unexpected error:', err);
    console.error();
  }
}

// 7. Run the examples

async function main() {
  console.log('### Safexpr basic Node example ###');
  console.log();

  runBasicCompile();
  runEngineExample();
  runWithCliExpression();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exitCode = 1;
});
