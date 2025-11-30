/**
 * SafExpr/scripts/release.ts
 *
 * Semi-automated local release helper for Safexpr.
 *
 * Responsibilities:
 *  - Bump the version in package.json (either by semver bump or explicit value).
 *  - Optionally update CHANGELOG.md "Unreleased" section with a new version heading.
 *  - Run lint, tests, and build to ensure the release is healthy.
 *  - Create a git commit and tag (vX.Y.Z).
 *
 * This script does NOT:
 *  - Push to remote.
 *  - Publish to npm directly (that is handled by GitHub Actions on tag push).
 *
 * Usage examples (from repo root):
 *
 *   # Bump patch version (e.g. 0.1.0 -> 0.1.1)
 *   npx tsx scripts/release.ts patch
 *
 *   # Bump minor version (e.g. 0.1.0 -> 0.2.0)
 *   npx tsx scripts/release.ts minor
 *
 *   # Bump major version (e.g. 0.1.0 -> 1.0.0)
 *   npx tsx scripts/release.ts major
 *
 *   # Set an explicit version
 *   npx tsx scripts/release.ts 0.2.0
 *
 * After this script succeeds:
 *   git push
 *   git push --tags
 *
 * This will trigger the GitHub Actions release workflow (release.yml),
 * which publishes the package to npm and creates a GitHub Release.
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

type BumpType = 'major' | 'minor' | 'patch';
type LogLevel = 'info' | 'warn' | 'error';

function log(level: LogLevel, message: string) {
  const prefix =
    level === 'info' ? '[release] ' : level === 'warn' ? '[release:warn] ' : '[release:ERROR] ';
  // eslint-disable-next-line no-console
  console[level === 'error' ? 'error' : 'log'](prefix + message);
}

function run(cmd: string, options: { stdio?: 'inherit' | 'pipe' } = { stdio: 'inherit' }) {
  log('info', `Running: ${cmd}`);
  execSync(cmd, { stdio: options.stdio ?? 'inherit' });
}

function isValidSemver(version: string): boolean {
  return /^\d+\.\d+\.\d+$/.test(version);
}

function parseSemver(version: string): [number, number, number] {
  if (!isValidSemver(version)) {
    throw new Error(`Invalid semver: "${version}". Expected format: X.Y.Z`);
  }
  const [major, minor, patch] = version.split('.').map((v) => parseInt(v, 10));
  return [major, minor, patch];
}

function compareSemver(a: string, b: string): number {
  const [aMaj, aMin, aPatch] = parseSemver(a);
  const [bMaj, bMin, bPatch] = parseSemver(b);

  if (aMaj !== bMaj) return aMaj - bMaj;
  if (aMin !== bMin) return aMin - bMin;
  return aPatch - bPatch;
}

function bumpSemver(current: string, bump: BumpType): string {
  const [major, minor, patch] = parseSemver(current);
  switch (bump) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
    default:
      throw new Error(`Unknown bump type: ${bump}`);
  }
}

function getGitStatusPorcelain(): string {
  try {
    return execSync('git status --porcelain', { stdio: 'pipe' }).toString().trim();
  } catch (err) {
    throw new Error('Failed to run "git status". Are you in a git repo?');
  }
}

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const answer: string = await new Promise((resolveAnswer) => {
    rl.question(question, (ans) => resolveAnswer(ans));
  });

  rl.close();
  const normalized = answer.trim().toLowerCase();
  return normalized === 'y' || normalized === 'yes';
}

function readJson(path: string): any {
  const content = readFileSync(path, 'utf8');
  return JSON.parse(content);
}

function writeJson(path: string, obj: any) {
  const json = JSON.stringify(obj, null, 2) + '\n';
  writeFileSync(path, json, 'utf8');
}

function updateChangelog(version: string, projectRoot: string) {
  const changelogPath = resolve(projectRoot, 'CHANGELOG.md');
  if (!existsSync(changelogPath)) {
    log('warn', 'CHANGELOG.md not found, skipping changelog update.');
    return;
  }

  const original = readFileSync(changelogPath, 'utf8');

  const unreleasedHeading = '## [Unreleased]';
  if (!original.includes(unreleasedHeading)) {
    log('warn', 'CHANGELOG.md does not contain "## [Unreleased]" section. Skipping update.');
    return;
  }

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  // Insert version section after "## [Unreleased]"
  const versionHeading = `## [${version}] – ${today}`;
  let updated = original.replace(
    unreleasedHeading,
    `${unreleasedHeading}\n\n${versionHeading}\n`,
  );

  // Update link references at the bottom if possible.
  // We expect something like:
  // [Unreleased]: https://github.com/<org>/<repo>/compare/v0.1.0...HEAD
  // [0.1.0]: https://github.com/<org>/<repo>/releases/tag/v0.1.0
  const unreleasedLinkRegex =
    /^\[Unreleased\]:\s*(https:\/\/github\.com\/.+?\/.+?\/compare\/)v(\d+\.\d+\.\d+)\.\.\.HEAD\s*$/m;

  const match = updated.match(unreleasedLinkRegex);
  if (match) {
    const fullMatch = match[0];
    const baseCompareUrl = match[1]; // e.g. https://github.com/TheSkiF4er/safexpr/compare/
    const previousVersion = match[2];

    const newUnreleasedLine = `[Unreleased]: ${baseCompareUrl}v${version}...HEAD`;
    const previousTagLinkPrefix = baseCompareUrl.replace('/compare/', '/releases/tag/');

    const newVersionLink = `[${version}]: ${previousTagLinkPrefix}v${version}`;

    updated = updated.replace(fullMatch, newUnreleasedLine);

    // Insert new version link after the [Unreleased] link line, if not already present.
    if (!updated.includes(`[${version}]:`)) {
      updated = updated.replace(
        newUnreleasedLine,
        `${newUnreleasedLine}\n${newVersionLink}`,
      );
    }

    // Ensure the previous version link still exists. If not, add a generic one.
    if (!updated.includes(`[${previousVersion}]:`)) {
      const previousVersionLink = `[${previousVersion}]: ${previousTagLinkPrefix}v${previousVersion}`;
      updated = `${updated.trimEnd()}\n${previousVersionLink}\n`;
    }
  } else {
    log(
      'warn',
      'Could not detect [Unreleased] link format. Leaving footer links unchanged in CHANGELOG.md.',
    );
  }

  writeFileSync(changelogPath, updated, 'utf8');
  log('info', `Updated CHANGELOG.md with version ${version}.`);
}

async function main() {
  const projectRoot = resolve(__dirname, '..');
  const packageJsonPath = resolve(projectRoot, 'package.json');
  if (!existsSync(packageJsonPath)) {
    throw new Error('package.json not found. Are you running from the project root?');
  }

  const args = process.argv.slice(2);
  if (args.length === 0) {
    log('error', 'No arguments provided.');
    log(
      'info',
      'Usage: npx tsx scripts/release.ts [patch|minor|major|X.Y.Z] [--yes]',
    );
    process.exitCode = 1;
    return;
  }

  const arg = args[0];
  const yesFlag = args.includes('--yes') || process.env.RELEASE_YES === 'true';

  const pkg = readJson(packageJsonPath);
  const currentVersion: string = pkg.version;
  if (!isValidSemver(currentVersion)) {
    throw new Error(
      `package.json version "${currentVersion}" is not a valid semver (expected X.Y.Z).`,
    );
  }

  let newVersion: string;
  if (arg === 'patch' || arg === 'minor' || arg === 'major') {
    newVersion = bumpSemver(currentVersion, arg);
  } else {
    if (!isValidSemver(arg)) {
      throw new Error(
        `Invalid argument "${arg}". Expected "patch", "minor", "major", or an explicit version X.Y.Z.`,
      );
    }
    newVersion = arg;
  }

  if (compareSemver(newVersion, currentVersion) <= 0) {
    throw new Error(
      `New version (${newVersion}) must be greater than current version (${currentVersion}).`,
    );
  }

  log('info', `Current version: ${currentVersion}`);
  log('info', `New version:     ${newVersion}`);
  log('info', '');

  // Check git status
  const status = getGitStatusPorcelain();
  if (status) {
    log(
      'warn',
      'Your working tree is not clean. It is recommended to commit or stash changes before releasing.',
    );
    // eslint-disable-next-line no-console
    console.log(status + '\n');
  }

  if (!yesFlag) {
    const proceed = await confirm(
      `Proceed with release v${newVersion}? This will modify package.json, CHANGELOG.md, run tests, and create a git tag. (y/N) `,
    );
    if (!proceed) {
      log('info', 'Release aborted by user.');
      return;
    }
  }

  // 1. Update package.json
  pkg.version = newVersion;
  writeJson(packageJsonPath, pkg);
  log('info', `Updated package.json version to ${newVersion}.`);

  // 2. Update CHANGELOG.md
  updateChangelog(newVersion, projectRoot);

  // 3. Run lint, tests, and build
  run('npm run lint');
  run('npm test');
  run('npm run build');

  // 4. Git commit & tag
  run('git add package.json CHANGELOG.md', { stdio: 'pipe' });
  run(`git commit -m "chore(release): v${newVersion}"`);
  run(`git tag v${newVersion}`);

  log('info', '');
  log('info', `Release v${newVersion} prepared successfully 🎉`);
  log(
    'info',
    'Next steps:\n' +
      '  1) git push\n' +
      '  2) git push --tags\n' +
      'This will trigger the GitHub Actions release workflow (Release).',
  );
}

main().catch((err) => {
  log('error', 'Release script failed.');
  if (err instanceof Error) {
    log('error', err.message);
  } else {
    log('error', String(err));
  }
  process.exitCode = 1;
});
