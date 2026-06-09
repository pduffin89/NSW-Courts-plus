import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const artifactsDir = join(root, 'artifacts');
const auditPath = join(artifactsDir, 'delivery-audit.json');
const archivePath = join(artifactsDir, 'argus-delta-courtlens.zip');

function nowIso() {
  return new Date().toISOString();
}

function runGate(label, command, args) {
  const startedAt = Date.now();
  console.log(`\n=== ${label}: ${command} ${args.join(' ')} ===`);
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const durationMs = Date.now() - startedAt;
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return {
    label,
    command: [command, ...args].join(' '),
    status: result.status,
    signal: result.signal,
    durationMs,
    ok: result.status === 0,
  };
}

function listArchiveEntries(archive) {
  if (!existsSync(archive)) return [];
  const result = spawnSync('unzip', ['-Z1', archive], { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) return [];
  return result.stdout.split('\n').map((line) => line.trim()).filter(Boolean);
}

const gates = [
  runGate('unit-tests', 'npm', ['test']),
  runGate('production-build', 'npm', ['run', 'build']),
  runGate('browser-and-extension-smoke', 'npm', ['run', 'smoke']),
  runGate('live-provider-smoke', 'npm', ['run', 'smoke:live']),
  runGate('package-verified-dist', 'node', ['scripts/package_extension.mjs']),
];

const automatedOk = gates.every((gate) => gate.ok);
const archiveExists = existsSync(archivePath);
const archiveSizeBytes = archiveExists ? statSync(archivePath).size : 0;
const archiveEntries = listArchiveEntries(archivePath);
const archiveForbiddenEntries = archiveEntries.filter((entry) => entry.endsWith('.map') || entry.endsWith('.DS_Store'));
const archiveReleaseClean = archiveExists && archiveEntries.length > 0 && archiveForbiddenEntries.length === 0;
const distChecks = [
  'dist/manifest.json',
  'dist/background.js',
  'dist/courtlist.js',
  'dist/caselaw.js',
  'dist/forms/access_application_2026.pdf',
  'dist/forms/application_non_party_access.pdf',
  'dist/vendor/pdf-lib.min.js',
  'dist/vendor/fontkit.umd.min.js',
].map((relativePath) => ({ relativePath, exists: existsSync(join(root, relativePath)) }));

const criteria = [
  {
    requirement: 'Full Vite/React/TypeScript production build',
    evidence: ['npm run build', 'dist/background.js', 'dist/courtlist.js', 'dist/caselaw.js'],
    status: gates.find((gate) => gate.label === 'production-build')?.ok && distChecks.slice(0, 4).every((check) => check.exists) ? 'pass' : 'fail',
  },
  {
    requirement: 'Unit and integration coverage for parsers, UI flows, providers, documents, accessibility, determinism, and local NER seam',
    evidence: ['npm test'],
    status: gates.find((gate) => gate.label === 'unit-tests')?.ok ? 'pass' : 'fail',
  },
  {
    requirement: 'Browser fixture smoke and real unpacked-extension smoke against routed NSW URLs',
    evidence: ['npm run smoke', 'scripts/browser_smoke.py', 'scripts/extension_load_smoke.py'],
    status: gates.find((gate) => gate.label === 'browser-and-extension-smoke')?.ok ? 'pass' : 'fail',
  },
  {
    requirement: 'Live provider smoke for non-secret endpoints and optional authenticated Argus search',
    evidence: ['npm run smoke:live', process.env.ARGUS_DELTA_TOKEN ? 'ARGUS_DELTA_TOKEN present' : 'ARGUS_DELTA_TOKEN absent; authenticated Argus branch skipped'],
    status: gates.find((gate) => gate.label === 'live-provider-smoke')?.ok ? (process.env.ARGUS_DELTA_TOKEN ? 'pass' : 'partial-external-credential-needed') : 'fail',
  },
  {
    requirement: 'Packaged extension archive from verified dist',
    evidence: ['node scripts/package_extension.mjs', 'artifacts/argus-delta-courtlens.zip'],
    status: gates.find((gate) => gate.label === 'package-verified-dist')?.ok && archiveExists && archiveSizeBytes > 0 ? 'pass' : 'fail',
  },
  {
    requirement: 'Release archive excludes debug source maps and macOS metadata',
    evidence: ['artifacts/argus-delta-courtlens.zip archive listing', archiveReleaseClean ? 'no .map or .DS_Store entries' : `forbidden entries: ${archiveForbiddenEntries.join(', ')}`],
    status: archiveReleaseClean ? 'pass' : 'fail',
  },
  {
    requirement: 'Manual smoke on live NSW Online Registry and NSW Caselaw in operator Chrome profile',
    evidence: ['docs/smoke-testing.md#manual-chrome-smoke'],
    status: 'manual-operator-required',
  },
];

const audit = {
  generatedAt: nowIso(),
  project: 'Argus Delta Courtlens v2',
  root,
  automatedOk,
  archive: {
    path: archivePath,
    exists: archiveExists,
    sizeBytes: archiveSizeBytes,
    entryCount: archiveEntries.length,
    releaseClean: archiveReleaseClean,
    forbiddenEntries: archiveForbiddenEntries,
    entries: archiveEntries,
  },
  gates,
  distChecks,
  criteria,
  externalOrManualGates: criteria.filter((item) => item.status.includes('external') || item.status.includes('manual')),
};

mkdirSync(artifactsDir, { recursive: true });
writeFileSync(auditPath, `${JSON.stringify(audit, null, 2)}\n`, 'utf8');
console.log(`\nDelivery audit written to ${auditPath}`);

if (!automatedOk || !archiveExists || archiveSizeBytes === 0 || !archiveReleaseClean || distChecks.some((check) => !check.exists)) {
  process.exit(1);
}

if (audit.externalOrManualGates.length > 0) {
  console.log('Delivery audit note: automated gates passed, but external/manual gates remain recorded in the audit JSON.');
}
