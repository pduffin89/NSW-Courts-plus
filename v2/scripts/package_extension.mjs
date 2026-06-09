import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const dist = join(root, 'dist');
const outDir = join(root, 'artifacts');
const archive = join(outDir, 'argus-delta-courtlens.zip');

if (!existsSync(join(dist, 'manifest.json'))) {
  throw new Error('dist/manifest.json missing; run npm run build first');
}
mkdirSync(outDir, { recursive: true });
if (existsSync(archive)) rmSync(archive);

const result = spawnSync('zip', ['-qr', archive, '.'], { cwd: dist, encoding: 'utf8' });
if (result.status !== 0) {
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  throw new Error(`zip failed with exit ${result.status}`);
}
console.log(`Packaged ${archive}`);
