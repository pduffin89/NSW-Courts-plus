import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const dist = join(root, 'dist');
const archive = join(root, 'artifacts', 'argus-delta-courtlens.zip');

const sourceScanRoots = [
  'extension',
  'fixtures',
  'scripts',
  'tests',
  'docs',
  '../.github/workflows/courtlens-v2.yml',
  'README.md',
  'CHANGELOG.md',
  'LICENSE',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'vite.config.ts',
  'vitest.config.ts',
];
const sourceScanExcludes = new Set([
  'scripts/secret_audit.mjs',
]);

const forbiddenArchiveEntries = [
  /^\.env(?:\.|$)/,
  /(?:^|\/)\.env(?:\.|$)/,
  /(?:^|\/)id_rsa$/,
  /(?:^|\/)[^/]*\.pem$/,
  /(?:^|\/)[^/]*\.key$/,
  /(?:^|\/)secrets?\./i,
];

const secretPatterns = [
  { label: 'private key block', pattern: /-----BEGIN (?:RSA |OPENSSH |EC |DSA |)?PRIVATE KEY-----/ },
  { label: 'OpenAI/Stripe live-style secret', pattern: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{20,}\b/ },
  { label: 'GitHub token', pattern: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/ },
  { label: 'GitLab token', pattern: /\bglpat-[A-Za-z0-9_-]{20,}\b/ },
  { label: 'Slack token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/ },
  { label: 'AWS access key', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { label: 'JWT literal', pattern: /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/ },
  { label: 'hardcoded bearer token', pattern: /Bearer\s+["']?[A-Za-z0-9._~+/=-]{24,}["']?/ },
  { label: 'hardcoded Argus token setting', pattern: /argusDeltaToken\s*[:=]\s*["'`][^"'`${}]{8,}["'`]/ },
  { label: 'hardcoded ABN GUID setting', pattern: /abnGuid\s*[:=]\s*["'`][0-9a-fA-F-]{24,}["'`]/ },
];

const textExtensions = new Set(['.js', '.mjs', '.ts', '.tsx', '.py', '.json', '.html', '.css', '.txt', '.md', '.map', '.yml', '.yaml']);

function fail(message) {
  throw new Error(`Secret audit failed: ${message}`);
}

function extensionOf(path) {
  const index = path.lastIndexOf('.');
  return index === -1 ? '' : path.slice(index).toLowerCase();
}

function walkFiles(dir, prefix = '') {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const relativePath = prefix ? `${prefix}/${entry}` : entry;
    if (statSync(fullPath).isDirectory()) files.push(...walkFiles(fullPath, relativePath));
    else files.push({ fullPath, relativePath });
  }
  return files;
}

function assertNoSecrets(label, path, content) {
  for (const secret of secretPatterns) {
    if (secret.pattern.test(content)) fail(`${label}:${path} contains ${secret.label}`);
  }
}

function sourceFiles() {
  const files = [];
  for (const relativePath of sourceScanRoots) {
    const fullPath = join(root, relativePath);
    if (!existsSync(fullPath)) continue;
    if (statSync(fullPath).isDirectory()) files.push(...walkFiles(fullPath, relativePath));
    else files.push({ fullPath, relativePath });
  }
  return files;
}

function assertNoForbiddenSourceSecretFiles() {
  for (const file of sourceFiles()) {
    if (file.relativePath === '.env.example') continue;
    if (forbiddenArchiveEntries.some((pattern) => pattern.test(file.relativePath))) {
      fail(`source tree contains forbidden secret-like file ${file.relativePath}`);
    }
  }
}

function readArchiveEntry(entry) {
  const result = spawnSync('unzip', ['-p', archive, entry], { cwd: root, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  if (result.status !== 0) fail(`unable to read archive entry ${entry}`);
  return result.stdout;
}

if (!existsSync(join(dist, 'manifest.json'))) fail('dist/manifest.json missing; run npm run build first');
if (!existsSync(archive)) fail('release archive missing; run node scripts/package_extension.mjs first');

assertNoForbiddenSourceSecretFiles();

let scannedSourceFiles = 0;
for (const file of sourceFiles()) {
  if (sourceScanExcludes.has(file.relativePath)) continue;
  if (!textExtensions.has(extensionOf(file.relativePath))) continue;
  scannedSourceFiles += 1;
  assertNoSecrets('source', file.relativePath, readFileSync(file.fullPath, 'utf8'));
}

let scannedDistFiles = 0;
for (const file of walkFiles(dist)) {
  if (!textExtensions.has(extensionOf(file.relativePath))) continue;
  scannedDistFiles += 1;
  assertNoSecrets('dist', file.relativePath, readFileSync(file.fullPath, 'utf8'));
}

const listing = spawnSync('unzip', ['-Z1', archive], { cwd: root, encoding: 'utf8' });
if (listing.status !== 0) fail('unable to list release archive');
const archiveEntries = listing.stdout.split('\n').map((line) => line.trim()).filter(Boolean);
for (const entry of archiveEntries) {
  if (forbiddenArchiveEntries.some((pattern) => pattern.test(entry))) fail(`release archive contains forbidden secret-like file ${entry}`);
}

let scannedArchiveFiles = 0;
for (const entry of archiveEntries) {
  if (entry.endsWith('/')) continue;
  if (!textExtensions.has(extensionOf(entry))) continue;
  scannedArchiveFiles += 1;
  assertNoSecrets('archive', entry, readArchiveEntry(entry));
}

console.log(`Secret audit passed: scanned ${scannedSourceFiles} source text file(s), ${scannedDistFiles} dist text file(s), ${scannedArchiveFiles} release archive text file(s), and ${archiveEntries.length} archive entr${archiveEntries.length === 1 ? 'y' : 'ies'}.`);
