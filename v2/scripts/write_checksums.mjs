import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

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
  'completion-audit.json',
  'manual-verification.json',
];

function fail(message) {
  throw new Error(`Checksum writer failed: ${message}`);
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

const lines = [];
for (const name of requiredArtifactNames) {
  const path = join(artifactsDir, name);
  if (!existsSync(path)) fail(`${name} missing; run npm run package:extension first`);
  lines.push(`${sha256(path)}  ${name}`);
}
for (const name of optionalArtifactNames) {
  const path = join(artifactsDir, name);
  if (existsSync(path)) lines.push(`${sha256(path)}  ${name}`);
}

writeFileSync(outputPath, `${lines.join('\n')}\n`, 'utf8');
console.log(`Wrote ${outputPath}`);
