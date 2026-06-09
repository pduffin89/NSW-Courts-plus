import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const dist = join(root, 'dist');
const outDir = join(root, 'artifacts');
const archive = join(outDir, 'argus-delta-courtlens.zip');
const fixedDosTime = 0;
const fixedDosDate = ((2026 - 1980) << 9) | (1 << 5) | 1;

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  crcTable[n] = c >>> 0;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosPath(path) {
  return path.replaceAll('\\', '/');
}

function walkFiles(dir, prefix = '') {
  const entries = [];
  for (const entry of readdirSync(dir).sort()) {
    const fullPath = join(dir, entry);
    const relativePath = prefix ? `${prefix}/${entry}` : entry;
    if (statSync(fullPath).isDirectory()) entries.push(...walkFiles(fullPath, relativePath));
    else entries.push({ fullPath, relativePath: dosPath(relativePath) });
  }
  return entries;
}

function stripReleaseOnlyDebugRefs(relativePath, buffer) {
  if (!relativePath.endsWith('.js')) return buffer;
  return Buffer.from(buffer.toString('utf8').replace(/\n?\/\/# sourceMappingURL=.*?(?=\n|$)/g, ''), 'utf8');
}

function collectReleaseEntries(sourceDir) {
  const files = walkFiles(sourceDir)
    .filter((file) => !file.relativePath.endsWith('.map') && !file.relativePath.endsWith('.DS_Store'))
    .map((file) => ({
      path: file.relativePath,
      type: 'file',
      data: stripReleaseOnlyDebugRefs(file.relativePath, readFileSync(file.fullPath)),
    }));

  const directorySet = new Set();
  for (const file of files) {
    const parts = file.path.split('/');
    parts.pop();
    let current = '';
    for (const part of parts) {
      current += `${part}/`;
      directorySet.add(current);
    }
  }

  return [
    ...[...directorySet].sort().map((path) => ({ path, type: 'directory', data: Buffer.alloc(0) })),
    ...files.sort((a, b) => a.path.localeCompare(b.path)),
  ].sort((a, b) => a.path.localeCompare(b.path));
}

function u16(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value & 0xffff, 0);
  return buffer;
}

function u32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0, 0);
  return buffer;
}

function createDeterministicZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.path, 'utf8');
    const data = entry.data;
    const crc = crc32(data);
    const isDirectory = entry.type === 'directory';
    const externalAttributes = isDirectory ? ((0o040755 << 16) | 0x10) : (0o100644 << 16);

    const localHeader = Buffer.concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(fixedDosTime),
      u16(fixedDosDate),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(name.length),
      u16(0),
      name,
    ]);
    localParts.push(localHeader, data);

    const centralHeader = Buffer.concat([
      u32(0x02014b50),
      u16(0x0314),
      u16(20),
      u16(0),
      u16(0),
      u16(fixedDosTime),
      u16(fixedDosDate),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(externalAttributes),
      u32(offset),
      name,
    ]);
    centralParts.push(centralHeader);
    offset += localHeader.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const endOfCentralDirectory = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(centralDirectory.length),
    u32(offset),
    u16(0),
  ]);

  return Buffer.concat([...localParts, centralDirectory, endOfCentralDirectory]);
}

function assertReleaseArchiveClean(archivePath) {
  const listing = spawnSync('unzip', ['-Z1', archivePath], { cwd: root, encoding: 'utf8' });
  if (listing.status !== 0) {
    process.stdout.write(listing.stdout || '');
    process.stderr.write(listing.stderr || '');
    throw new Error(`archive listing failed with exit ${listing.status}`);
  }
  const entries = listing.stdout.split('\n').map((line) => line.trim()).filter(Boolean);
  const forbidden = entries.filter((entry) => entry.endsWith('.map') || entry.endsWith('.DS_Store'));
  if (forbidden.length) throw new Error(`release archive contains forbidden debug/macOS files: ${forbidden.join(', ')}`);

  for (const entry of entries.filter((item) => item.endsWith('.js'))) {
    const jsCheck = spawnSync('unzip', ['-p', archivePath, entry], { cwd: root, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
    if (jsCheck.status !== 0) throw new Error(`failed to inspect ${entry} in archive`);
    if (jsCheck.stdout.includes('sourceMappingURL=')) throw new Error(`release archive JS contains sourceMappingURL in ${entry}`);
  }
}

if (!existsSync(join(dist, 'manifest.json'))) throw new Error('dist/manifest.json missing; run npm run build first');
mkdirSync(outDir, { recursive: true });
if (existsSync(archive)) rmSync(archive);
mkdirSync(dirname(archive), { recursive: true });

const entries = collectReleaseEntries(dist);
writeFileSync(archive, createDeterministicZip(entries));
assertReleaseArchiveClean(archive);
console.log(`Packaged deterministic release-clean ${archive}`);
