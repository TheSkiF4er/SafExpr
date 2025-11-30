/**
 * SafExpr/scripts/generate-docs.ts
 *
 * Simple documentation generator for Safexpr.
 *
 * Responsibilities:
 *  - Ensure the docs/api directory exists (and optionally clean it).
 *  - Run TypeDoc against the Safexpr source, generating API reference docs.
 *
 * This script is intentionally small and focused: it delegates the heavy lifting to TypeDoc.
 *
 * Requirements (devDependencies in the root package.json):
 *   "typedoc": "^0.26.0"   (or a compatible version)
 *
 * Suggested NPM script in package.json:
 *   "scripts": {
 *     "docs": "tsx scripts/generate-docs.ts"
 *   }
 *
 * Usage:
 *   npm run docs
 *
 * The script will:
 *   - Generate API docs into docs/api
 *   - Fail with a clear error message if typedoc is not installed
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

type LogLevel = 'info' | 'warn' | 'error';

function log(level: LogLevel, message: string) {
  const prefix =
    level === 'info' ? '[docs] ' : level === 'warn' ? '[docs:warn] ' : '[docs:ERROR] ';
  // eslint-disable-next-line no-console
  console[level === 'error' ? 'error' : 'log'](prefix + message);
}

function ensureDocsDir(docDir: string) {
  if (!existsSync(docDir)) {
    log('info', `Creating docs directory: ${docDir}`);
    mkdirSync(docDir, { recursive: true });
  }
}

/**
 * Optionally clean the docs/api output directory before generating fresh docs.
 */
function cleanDocsDir(docDir: string) {
  if (existsSync(docDir)) {
    log('info', `Cleaning existing docs output: ${docDir}`);
    rmSync(docDir, { recursive: true, force: true });
  }
}

/**
 * Check if TypeDoc is available (either locally via node_modules or globally via npx).
 * We don't strictly check the version here – any compatible version is fine.
 */
function checkTypedocInstalled() {
  try {
    execSync('npx typedoc --version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Build the command line for TypeDoc.
 *
 * You can optionally create a typedoc.json at the project root and simplify this.
 * For now we pass a minimal but reasonable set of options inline.
 */
function buildTypedocCommand(outDir: string): string {
  const tsconfig = resolve(__dirname, '../tsconfig.json');
  const srcEntry = resolve(__dirname, '../src/index.ts');

  const cmdParts = [
    'npx typedoc',
    `"${srcEntry}"`,
    `--out "${outDir}"`,
    `--tsconfig "${tsconfig}"`,
    '--entryPointStrategy expand',
    '--cleanOutputDir false',
    '--excludeExternals',
    '--excludePrivate',
    '--excludeProtected',
    '--hideGenerator',
    '--readme none', // we have our own docs; API reference only
    '--includeVersion',
  ];

  return cmdParts.join(' ');
}

async function main() {
  const docsRoot = resolve(__dirname, '../docs');
  const docsApiDir = resolve(docsRoot, 'api');

  log('info', 'Starting Safexpr API docs generation…');
  log('info', `Project root: ${resolve(__dirname, '..')}`);
  log('info', `Docs root:    ${docsRoot}`);
  log('info', `API output:   ${docsApiDir}`);

  if (!checkTypedocInstalled()) {
    log(
      'error',
      'TypeDoc does not appear to be installed. Please add it as a devDependency:',
    );
    log('error', '  npm install --save-dev typedoc');
    process.exitCode = 1;
    return;
  }

  // Ensure ./docs exists
  ensureDocsDir(docsRoot);

  // Clean ./docs/api to avoid stale files
  cleanDocsDir(docsApiDir);
  ensureDocsDir(docsApiDir);

  const cmd = buildTypedocCommand(docsApiDir);
  log('info', `Running: ${cmd}`);

  try {
    execSync(cmd, { stdio: 'inherit' });
    log('info', 'API documentation generated successfully 🎉');
  } catch (err) {
    log('error', 'Failed to generate API documentation with TypeDoc.');
    if (err instanceof Error) {
      log('error', err.message);
    }
    process.exitCode = 1;
  }
}

main().catch((err) => {
  log('error', 'Unexpected error while generating docs.');
  if (err instanceof Error) {
    log('error', err.stack ?? err.message);
  }
  process.exitCode = 1;
});
