import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const dist = join(root, 'dist');
const outDir = join(root, 'artifacts');
const archive = join(outDir, 'argus-delta-courtlens.zip');

function walkFiles(dir, prefix = '') {
  const entries = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const relativePath = prefix ? `${prefix}/${entry}` : entry;
    if (statSync(fullPath).isDirectory()) entries.push(...walkFiles(fullPath, relativePath));
    else entries.push({ fullPath, relativePath });
  }
  return entries;
}

function prepareReleaseStaging(sourceDir) {
  const staging = mkdtempSync(join(tmpdir(), 'courtlens-release-'));
  cpSync(sourceDir, staging, { recursive: true });
  for (const file of walkFiles(staging)) {
    if (file.relativePath.endsWith('.map') || file.relativePath.endsWith('.DS_Store')) {
      rmSync(file.fullPath);
      continue;
    }
    if (file.relativePath.endsWith('.js')) {
      const text = readFileSync(file.fullPath, 'utf8').replace(/\n?\/\/# sourceMappingURL=.*?(?=\n|$)/g, '');
      writeFileSync(file.fullPath, text, 'utf8');
    }
  }
  return staging;
}

if (!existsSync(join(dist, 'manifest.json'))) {
  throw new Error('dist/manifest.json missing; run npm run build first');
}
mkdirSync(outDir, { recursive: true });
if (existsSync(archive)) rmSync(archive);

const staging = prepareReleaseStaging(dist);
try {
  const result = spawnSync('zip', ['-qr', archive, '.'], { cwd: staging, encoding: 'utf8' });
  if (result.status !== 0) {
    process.stdout.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    throw new Error(`zip failed with exit ${result.status}`);
  }

  const listing = spawnSync('unzip', ['-Z1', archive], { cwd: root, encoding: 'utf8' });
  if (listing.status !== 0) {
    process.stdout.write(listing.stdout || '');
    process.stderr.write(listing.stderr || '');
    throw new Error(`archive listing failed with exit ${listing.status}`);
  }
  const entries = listing.stdout.split('\n').map((line) => line.trim()).filter(Boolean);
  const forbidden = entries.filter((entry) => entry.endsWith('.map') || entry.endsWith('.DS_Store'));
  if (forbidden.length) {
    throw new Error(`release archive contains forbidden debug/macOS files: ${forbidden.join(', ')}`);
  }
  for (const entry of entries.filter((item) => item.endsWith('.js'))) {
    const jsCheck = spawnSync('unzip', ['-p', archive, entry], { cwd: root, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
    if (jsCheck.status !== 0) throw new Error(`failed to inspect ${entry} in archive`);
    if (jsCheck.stdout.includes('sourceMappingURL=')) throw new Error(`release archive JS contains sourceMappingURL in ${entry}`);
  }

  console.log(`Packaged release-clean ${archive}`);
} finally {
  rmSync(staging, { recursive: true, force: true });
}
