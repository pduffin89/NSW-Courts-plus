import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
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

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function runText(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

function listArchiveEntries(archive) {
  if (!existsSync(archive)) return [];
  const result = spawnSync('unzip', ['-Z1', archive], { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) return [];
  return result.stdout.split('\n').map((line) => line.trim()).filter(Boolean);
}

function describeArchiveEntry(archive, entry) {
  if (entry.endsWith('/')) return { path: entry, type: 'directory' };
  const result = spawnSync('unzip', ['-p', archive, entry], { cwd: root, encoding: 'buffer', maxBuffer: 20 * 1024 * 1024 });
  if (result.status !== 0) return { path: entry, type: 'file', readable: false };
  return {
    path: entry,
    type: 'file',
    sizeBytes: result.stdout.length,
    sha256: sha256(result.stdout),
  };
}

const gates = [
  runGate('unit-tests', 'npm', ['test']),
  runGate('dependency-security-audit', 'npm', ['audit', '--audit-level=moderate']),
  runGate('production-build', 'npm', ['run', 'build']),
  runGate('browser-and-extension-smoke', 'npm', ['run', 'smoke']),
  runGate('live-provider-smoke', 'npm', ['run', 'smoke:live']),
  runGate('live-public-extension-smoke', 'npm', ['run', 'smoke:live-extension']),
  runGate('package-verified-dist', 'node', ['scripts/package_extension.mjs']),
];

const automatedOk = gates.every((gate) => gate.ok);
const archiveExists = existsSync(archivePath);
const archiveSizeBytes = archiveExists ? statSync(archivePath).size : 0;
const archiveSha256 = archiveExists ? sha256(readFileSync(archivePath)) : null;
const archiveEntries = listArchiveEntries(archivePath);
const archiveEntryDetails = archiveEntries.map((entry) => describeArchiveEntry(archivePath, entry));
const archiveForbiddenEntries = archiveEntries.filter((entry) => entry.endsWith('.map') || entry.endsWith('.DS_Store'));
const archiveReleaseClean = archiveExists && archiveEntries.length > 0 && archiveForbiddenEntries.length === 0;
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const dependencySpecs = Object.entries({
  ...(packageJson.dependencies || {}),
  ...(packageJson.devDependencies || {}),
}).map(([name, spec]) => ({ name, spec }));
const nonExactDependencySpecs = dependencySpecs.filter(({ spec }) =>
  spec === 'latest' || spec === '*' || /^[~^<>]/.test(spec) || spec.includes('x')
);
const dependencySpecsPinned = nonExactDependencySpecs.length === 0;
const git = {
  branch: runText('git', ['rev-parse', '--abbrev-ref', 'HEAD']),
  headSha: runText('git', ['rev-parse', 'HEAD']),
  statusShort: runText('git', ['status', '--short']),
};
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
    requirement: 'Dependency versions are pinned for reproducible installs',
    evidence: dependencySpecsPinned ? ['package.json exact dependency/devDependency versions'] : nonExactDependencySpecs.map(({ name, spec }) => `${name}@${spec}`),
    status: dependencySpecsPinned ? 'pass' : 'fail',
  },
  {
    requirement: 'Dependency security audit has no moderate-or-higher vulnerabilities',
    evidence: ['npm audit --audit-level=moderate'],
    status: gates.find((gate) => gate.label === 'dependency-security-audit')?.ok ? 'pass' : 'fail',
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
    requirement: 'Live public NSW Caselaw and NSW Online Registry pages load the real unpacked extension and sidebar',
    evidence: [
      'npm run smoke:live-extension',
      'scripts/live_extension_smoke.py',
      process.env.CASELAW_LIVE_URL || 'https://www.caselaw.nsw.gov.au/search?query=Smith&page=1',
      process.env.ONLINEREGISTRY_LIVE_URL || 'https://onlineregistry.lawlink.nsw.gov.au/content/court-lists',
    ],
    status: gates.find((gate) => gate.label === 'live-public-extension-smoke')?.ok ? 'pass' : 'fail',
  },
  {
    requirement: 'Packaged extension archive from verified dist',
    evidence: ['node scripts/package_extension.mjs', 'artifacts/argus-delta-courtlens.zip', archiveSha256 ? `sha256:${archiveSha256}` : 'sha256 unavailable'],
    status: gates.find((gate) => gate.label === 'package-verified-dist')?.ok && archiveExists && archiveSizeBytes > 0 ? 'pass' : 'fail',
  },
  {
    requirement: 'Release archive excludes debug source maps and macOS metadata',
    evidence: ['artifacts/argus-delta-courtlens.zip archive listing', archiveReleaseClean ? 'no .map or .DS_Store entries' : `forbidden entries: ${archiveForbiddenEntries.join(', ')}`],
    status: archiveReleaseClean ? 'pass' : 'fail',
  },
  {
    requirement: 'Operator-assisted smoke for authenticated or targeted live NSW workflows in a headed Chrome profile',
    evidence: ['npm run smoke:operator', 'scripts/operator_live_smoke.py', 'docs/smoke-testing.md#operator-assisted-live-chrome-smoke'],
    status: 'manual-operator-required',
  },
];

const audit = {
  generatedAt: nowIso(),
  project: 'Argus Delta Courtlens v2',
  root,
  git,
  automatedOk,
  archive: {
    path: archivePath,
    exists: archiveExists,
    sizeBytes: archiveSizeBytes,
    sha256: archiveSha256,
    entryCount: archiveEntries.length,
    releaseClean: archiveReleaseClean,
    forbiddenEntries: archiveForbiddenEntries,
    entries: archiveEntries,
    entryDetails: archiveEntryDetails,
  },
  gates,
  dependencySpecs,
  nonExactDependencySpecs,
  distChecks,
  criteria,
  externalOrManualGates: criteria.filter((item) => item.status.includes('external') || item.status.includes('manual')),
};

mkdirSync(artifactsDir, { recursive: true });
writeFileSync(auditPath, `${JSON.stringify(audit, null, 2)}\n`, 'utf8');
console.log(`\nDelivery audit written to ${auditPath}`);

if (!automatedOk || !dependencySpecsPinned || !archiveExists || archiveSizeBytes === 0 || !archiveReleaseClean || distChecks.some((check) => !check.exists)) {
  process.exit(1);
}

if (audit.externalOrManualGates.length > 0) {
  console.log('Delivery audit note: automated gates passed, but external/manual gates remain recorded in the audit JSON.');
}
