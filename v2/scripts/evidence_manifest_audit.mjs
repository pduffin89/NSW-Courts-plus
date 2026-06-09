import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const artifactsDir = join(root, 'artifacts');
const sumsPath = join(artifactsDir, 'SHA256SUMS');
const requiredEntries = [
  'argus-delta-courtlens.zip',
  'delivery-audit.json',
  'release-readiness.json',
  'screenshots/01-overview.png',
  'screenshots/02-research.png',
  'screenshots/03-documents.png',
  'screenshots/04-settings.png',
];
const optionalEntries = new Set([
  'live-smoke.json',
  'operator-live-smoke.json',
  'operator-smoke-verification.json',
  'ci-artifact-parity.json',
  'standalone-live-smoke-artifact.json',
  'completion-audit.json',
  'manual-verification.json',
]);

function fail(message) {
  throw new Error(`Evidence manifest audit failed: ${message}`);
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function gitHead() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) fail('could not determine current git HEAD');
  return result.stdout.trim();
}

function artifactHead(name, payload) {
  if (name === 'delivery-audit.json') return payload?.git?.headSha || null;
  if (name === 'release-readiness.json') return payload?.gitHead || null;
  if (name === 'completion-audit.json') return payload?.git?.headSha || null;
  if (name === 'ci-artifact-parity.json') return payload?.headSha || null;
  if (name === 'standalone-live-smoke-artifact.json') return payload?.headSha || null;
  if (name === 'live-smoke.json') return payload?.gitHead || null;
  if (name === 'operator-live-smoke.json') return payload?.gitHead || null;
  if (name === 'operator-smoke-verification.json') return payload?.headSha || null;
  if (name === 'manual-verification.json') return payload?.gitHead || payload?.headSha || null;
  return null;
}

function readJsonArtifact(name) {
  try {
    return JSON.parse(readFileSync(join(artifactsDir, name), 'utf8'));
  } catch (error) {
    fail(`${name} is not valid JSON: ${error.message}`);
  }
}

if (!existsSync(sumsPath)) fail('artifacts/SHA256SUMS is missing; run npm run write:checksums');
const currentHead = gitHead();
const lines = readFileSync(sumsPath, 'utf8').split('\n').map((line) => line.trim()).filter(Boolean);
const seen = new Map();
for (const line of lines) {
  const match = line.match(/^([0-9a-f]{64})  (.+)$/i);
  if (!match) fail(`invalid checksum line: ${line}`);
  const [, expectedSha, relativePath] = match;
  if (seen.has(relativePath)) fail(`duplicate checksum entry: ${relativePath}`);
  const filePath = join(artifactsDir, relativePath);
  if (!existsSync(filePath)) fail(`${relativePath} is listed but missing`);
  const actualSha = sha256(filePath);
  if (actualSha !== expectedSha) fail(`${relativePath} checksum mismatch: expected ${expectedSha}, got ${actualSha}`);
  seen.set(relativePath, expectedSha);
}

for (const entry of requiredEntries) {
  if (!seen.has(entry)) fail(`required checksum entry missing: ${entry}`);
}

for (const entry of seen.keys()) {
  if (requiredEntries.includes(entry)) continue;
  if (!optionalEntries.has(entry)) fail(`unexpected checksum entry: ${entry}`);
  const payload = readJsonArtifact(entry);
  const head = artifactHead(entry, payload);
  if (head !== currentHead) fail(`${entry} records head ${head || 'missing'}, expected current HEAD ${currentHead}`);
}

for (const entry of ['delivery-audit.json', 'release-readiness.json']) {
  const payload = readJsonArtifact(entry);
  const head = artifactHead(entry, payload);
  if (head !== currentHead) fail(`${entry} records head ${head || 'missing'}, expected current HEAD ${currentHead}`);
}

console.log(`Evidence manifest audit passed: ${seen.size} checksum entries, HEAD ${currentHead}`);
