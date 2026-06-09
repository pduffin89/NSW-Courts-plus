import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const root = process.cwd();
const artifactsDir = join(root, 'artifacts');
const outputPath = join(artifactsDir, 'SHA256SUMS');
const artifactNames = [
  'argus-delta-courtlens.zip',
  'delivery-audit.json',
  'release-readiness.json',
];

function fail(message) {
  throw new Error(`Checksum writer failed: ${message}`);
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

const lines = [];
for (const name of artifactNames) {
  const path = join(artifactsDir, name);
  if (!existsSync(path)) fail(`${name} missing; run npm run package:extension first`);
  lines.push(`${sha256(path)}  ${name}`);
}

writeFileSync(outputPath, `${lines.join('\n')}\n`, 'utf8');
console.log(`Wrote ${outputPath}`);
