import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const artifactsDir = join(root, 'artifacts');
const outputPath = join(artifactsDir, 'SHA256SUMS');
const requiredArtifactNames = [
  'argus-delta-courtlens.zip',
  'delivery-audit.json',
  'release-readiness.json',
  'screenshots/01-overview.png',
  'screenshots/02-research.png',
  'screenshots/03-documents.png',
  'screenshots/04-settings.png',
];
const optionalArtifactNames = [
  'live-smoke.json',
  'operator-live-smoke.json',
  'ci-artifact-parity.json',
  'standalone-live-smoke-artifact.json',
  'completion-audit.json',
  'manual-verification.json',
];

function fail(message) {
  throw new Error(`Checksum writer failed: ${message}`);
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function gitHead() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) fail('could not determine current git HEAD');
  return result.stdout.trim();
}

function optionalArtifactHead(name, payload) {
  if (name === 'completion-audit.json') return payload?.git?.headSha || null;
  if (name === 'ci-artifact-parity.json') return payload?.headSha || null;
  if (name === 'standalone-live-smoke-artifact.json') return payload?.headSha || null;
  if (name === 'live-smoke.json') return payload?.gitHead || null;
  if (name === 'operator-live-smoke.json') return payload?.gitHead || null;
  if (name === 'manual-verification.json') return payload?.gitHead || payload?.headSha || null;
  return null;
}

function includeOptionalArtifact(name, currentHead) {
  const path = join(artifactsDir, name);
  if (!existsSync(path)) return false;
  let payload;
  try {
    payload = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    console.log(`Skipping optional checksum artifact ${name}: not valid JSON`);
    return false;
  }
  const artifactHead = optionalArtifactHead(name, payload);
  if (artifactHead !== currentHead) {
    console.log(`Skipping optional checksum artifact ${name}: head ${artifactHead || 'missing'} does not match current HEAD ${currentHead}`);
    return false;
  }
  return true;
}

const currentHead = gitHead();
const lines = [];
for (const name of requiredArtifactNames) {
  const path = join(artifactsDir, name);
  if (!existsSync(path)) fail(`${name} missing; run npm run package:extension first`);
  lines.push(`${sha256(path)}  ${name}`);
}
for (const name of optionalArtifactNames) {
  const path = join(artifactsDir, name);
  if (includeOptionalArtifact(name, currentHead)) lines.push(`${sha256(path)}  ${name}`);
}

writeFileSync(outputPath, `${lines.join('\n')}\n`, 'utf8');
console.log(`Wrote ${outputPath}`);
