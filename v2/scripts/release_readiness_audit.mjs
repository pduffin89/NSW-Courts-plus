import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const archivePath = join(root, 'artifacts', 'argus-delta-courtlens.zip');
const auditPath = join(root, 'artifacts', 'delivery-audit.json');
const readinessPath = join(root, 'artifacts', 'release-readiness.json');

const expectedPermissions = ['storage'];
const expectedHostPermissions = [
  'http://127.0.0.1/*',
  'http://localhost/*',
  'https://abr.business.gov.au/*',
  'https://be-api.argusdelta.com/*',
  'https://news.google.com/*',
  'https://search.judgments.fedcourt.gov.au/*',
  'https://www.caselaw.nsw.gov.au/*',
];
const expectedCsp = { extension_pages: "script-src 'self'; object-src 'none'" };
const allowedNonPassStatuses = new Map([
  ['Live provider smoke for non-secret endpoints plus optional authenticated Argus and ABN name-search checks', 'partial-external-credential-needed'],
  ['Operator-assisted smoke for authenticated or targeted live NSW workflows in a headed Chrome profile', 'manual-operator-required'],
]);

function fail(message) {
  throw new Error(`Release readiness audit failed: ${message}`);
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function sorted(value) {
  return [...value].sort();
}

function assertExactSet(label, actual, expected) {
  const actualSorted = sorted(actual || []);
  const expectedSorted = sorted(expected);
  if (JSON.stringify(actualSorted) !== JSON.stringify(expectedSorted)) {
    fail(`${label} mismatch. expected ${JSON.stringify(expectedSorted)}, got ${JSON.stringify(actualSorted)}`);
  }
}

function fileContains(relativePath, needles) {
  const path = join(root, relativePath);
  if (!existsSync(path)) return false;
  const text = readFileSync(path, 'utf8');
  return needles.every((needle) => text.includes(needle));
}

function gitHead() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) fail('unable to read git HEAD');
  return result.stdout.trim();
}

function readZipEntry(entry) {
  const result = spawnSync('unzip', ['-p', archivePath, entry], { cwd: root, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  if (result.status !== 0) fail(`unable to read ${entry} from release archive`);
  return result.stdout;
}

function listZipEntries() {
  const result = spawnSync('unzip', ['-Z1', archivePath], { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) fail('unable to list release archive');
  return result.stdout.split('\n').map((line) => line.trim()).filter(Boolean);
}

if (!existsSync(archivePath)) fail('artifacts/argus-delta-courtlens.zip missing; run npm run package:extension first');
if (!existsSync(auditPath)) fail('artifacts/delivery-audit.json missing; run npm run package:extension first');

const audit = JSON.parse(readFileSync(auditPath, 'utf8'));
const archiveSha = sha256(archivePath);
const head = gitHead();

if (audit.git?.headSha !== head) fail(`delivery-audit git head ${audit.git?.headSha} does not match current HEAD ${head}`);
if (audit.archive?.sha256 !== archiveSha) fail(`delivery-audit archive SHA ${audit.archive?.sha256} does not match ${archiveSha}`);
if (audit.automatedOk !== true) fail('delivery-audit automatedOk is not true');
if (!Array.isArray(audit.featureMatrix) || !audit.featureMatrix.every((item) => item.status === 'pass')) fail('featureMatrix is not fully passing');
if (!fileContains('package.json', ['"verify:ci-artifact-parity": "node scripts/verify_ci_artifact_parity.mjs"'])) fail('package.json missing verify:ci-artifact-parity command');
if (!fileContains('scripts/verify_ci_artifact_parity.mjs', ['gh', 'run', 'download', 'SHA256SUMS', 'release ZIP differs between local and CI'])) fail('CI artifact parity verifier is missing expected checks');
if (!fileContains('docs/release-readiness.md', ['verify:ci-artifact-parity', 'argus-delta-courtlens', 'byte-for-byte'])) fail('release-readiness docs do not describe CI artifact parity verification');
if (!fileContains('../.github/workflows/courtlens-v2.yml', ['workflow_dispatch:', 'ARGUS_DELTA_TOKEN: ${{ secrets.ARGUS_DELTA_TOKEN }}', 'ABN_GUID: ${{ secrets.ABN_GUID }}', 'COURTLENS_ABN_GUID: ${{ secrets.COURTLENS_ABN_GUID }}'])) fail('CI workflow must support manual credentialed live-smoke reruns with optional secrets');

for (const criterion of audit.criteria || []) {
  if (criterion.status === 'pass') continue;
  if (allowedNonPassStatuses.get(criterion.requirement) === criterion.status) continue;
  fail(`unexpected non-pass criterion: ${criterion.requirement} (${criterion.status})`);
}

const entries = listZipEntries();
if (entries.some((entry) => entry.endsWith('.map') || entry.includes('.DS_Store'))) fail('release archive contains source maps or macOS metadata');
if (!entries.includes('manifest.json')) fail('release archive missing manifest.json');

const manifest = JSON.parse(readZipEntry('manifest.json'));
if (manifest.manifest_version !== 3) fail(`manifest_version must be 3, got ${manifest.manifest_version}`);
assertExactSet('permissions', manifest.permissions, expectedPermissions);
assertExactSet('host_permissions', manifest.host_permissions, expectedHostPermissions);
if (JSON.stringify(manifest.content_security_policy || {}) !== JSON.stringify(expectedCsp)) fail('manifest content_security_policy mismatch');
if ((manifest.web_accessible_resources || []).length !== 0) fail('manifest exposes web_accessible_resources');
for (const forbiddenKey of ['optional_permissions', 'optional_host_permissions', 'externally_connectable', 'oauth2', 'key', 'update_url']) {
  if (forbiddenKey in manifest) fail(`manifest contains forbidden key ${forbiddenKey}`);
}

const readiness = {
  generatedAt: new Date().toISOString(),
  ok: true,
  gitHead: head,
  archive: {
    path: archivePath,
    sha256: archiveSha,
    entryCount: entries.length,
  },
  deliveryAudit: {
    path: auditPath,
    automatedOk: audit.automatedOk,
    featureMatrixOk: audit.featureMatrix.every((item) => item.status === 'pass'),
  },
  manifest: {
    permissions: manifest.permissions,
    hostPermissions: manifest.host_permissions,
    contentSecurityPolicy: manifest.content_security_policy,
    webAccessibleResourceCount: (manifest.web_accessible_resources || []).length,
  },
  ciArtifactParity: {
    command: 'npm run verify:ci-artifact-parity -- --run-id <run-id>',
    verifies: [
      'CI artifact SHA256SUMS',
      'CI audit/readiness git provenance',
      'local release ZIP equals CI release ZIP byte-for-byte',
    ],
  },
  expectedExternalOrManualGates: (audit.criteria || [])
    .filter((criterion) => criterion.status !== 'pass')
    .map((criterion) => ({ requirement: criterion.requirement, status: criterion.status })),
};
writeFileSync(readinessPath, `${JSON.stringify(readiness, null, 2)}\n`, 'utf8');

console.log(`Release readiness audit passed: HEAD ${head}, archive sha256 ${archiveSha}, ${entries.length} archive entries, expected external/manual gates only. Evidence written to ${readinessPath}.`);
