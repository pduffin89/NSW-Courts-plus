import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const root = process.cwd();
const archive = join(root, 'artifacts', 'argus-delta-courtlens.zip');

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function packageOnce(label) {
  const result = spawnSync('node', ['scripts/package_extension.mjs'], { cwd: root, encoding: 'utf8' });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) throw new Error(`${label} package failed with exit ${result.status}`);
  return sha256File(archive);
}

const first = packageOnce('first');
const second = packageOnce('second');
if (first !== second) {
  throw new Error(`Package determinism failed: ${first} !== ${second}`);
}

console.log(`Package determinism passed: ${first}`);
