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
  runGate('extension-policy-audit', 'npm', ['run', 'audit:policy']),
  runGate('browser-and-extension-smoke', 'npm', ['run', 'smoke']),
  runGate('release-screenshot-capture', 'npm', ['run', 'capture:screenshots']),
  runGate('live-provider-smoke', 'npm', ['run', 'smoke:live']),
  runGate('live-public-extension-smoke', 'npm', ['run', 'smoke:live-extension']),
  runGate('package-verified-dist', 'node', ['scripts/package_extension.mjs']),
  runGate('package-determinism-audit', 'npm', ['run', 'audit:package-determinism']),
  runGate('release-extension-smoke', 'npm', ['run', 'smoke:release-extension']),
  runGate('release-secret-audit', 'npm', ['run', 'audit:secrets']),
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
const argusLiveCredentialPresent = Boolean(process.env.ARGUS_DELTA_TOKEN);
const abnLiveCredentialPresent = Boolean(process.env.ABN_GUID || process.env.COURTLENS_ABN_GUID);
const optionalLiveCredentialsPresent = argusLiveCredentialPresent && abnLiveCredentialPresent;
const git = {
  branch: runText('git', ['rev-parse', '--abbrev-ref', 'HEAD']),
  headSha: runText('git', ['rev-parse', 'HEAD']),
  statusShort: runText('git', ['status', '--short']),
};
const screenshotChecks = [
  'artifacts/screenshots/01-overview.png',
  'artifacts/screenshots/02-research.png',
  'artifacts/screenshots/03-documents.png',
  'artifacts/screenshots/04-settings.png',
].map((relativePath) => ({ relativePath, exists: existsSync(join(root, relativePath)) }));
const distChecks = [
  'dist/manifest.json',
  'dist/background.js',
  'dist/courtlist.js',
  'dist/caselaw.js',
  'dist/forms/access_application_2026.pdf',
  'dist/forms/application_non_party_access.pdf',
  'dist/vendor/pdf-lib.min.js',
  'dist/vendor/fontkit.umd.min.js',
  'dist/icons/icon-16.png',
  'dist/icons/icon-32.png',
  'dist/icons/icon-48.png',
  'dist/icons/icon-128.png',
].map((relativePath) => ({ relativePath, exists: existsSync(join(root, relativePath)) }));

function fileExists(relativePath) {
  return existsSync(join(root, relativePath));
}

function fileContains(relativePath, needles) {
  if (!fileExists(relativePath)) return false;
  const text = readFileSync(join(root, relativePath), 'utf8');
  return needles.every((needle) => text.includes(needle));
}

function gateOk(label) {
  return Boolean(gates.find((gate) => gate.label === label)?.ok);
}

function feature(requirement, evidence, checks) {
  const failedChecks = checks.filter((check) => !check.ok).map((check) => check.name);
  return {
    requirement,
    evidence,
    checks,
    status: failedChecks.length ? 'fail' : 'pass',
    failedChecks,
  };
}

const featureMatrix = [
  feature('New full Vite/React/TypeScript MV3 Chrome extension project', [
    'package.json', 'vite.config.ts', 'tsconfig.json', 'extension/manifest.json', 'extension/src/sidebar/CourtlensSidebar.tsx'
  ], [
    { name: 'package declares Vite/React/TypeScript dependencies', ok: fileContains('package.json', ['"vite"', '"react"', '"typescript"']) },
    { name: 'MV3 manifest source exists and declares manifest_version 3', ok: fileContains('extension/manifest.json', ['"manifest_version": 3', 'Argus Delta Courtlens']) },
    { name: 'manifest declares store-ready icons and action default icons', ok: fileContains('extension/public/manifest.json', ['"icons"', 'icons/icon-128.png', '"default_icon"']) },
    { name: 'manifest declares strict extension-page CSP', ok: fileContains('extension/public/manifest.json', ["script-src 'self'; object-src 'none'"]) },
    { name: 'manifest does not expose bundled assets as web-accessible resources', ok: !fileContains('extension/public/manifest.json', ['web_accessible_resources']) },
    { name: 'manifest has no optional or externally connectable surfaces', ok: !fileContains('extension/public/manifest.json', ['optional_permissions', 'optional_host_permissions', 'externally_connectable']) },
    { name: 'React sidebar source exists', ok: fileExists('extension/src/sidebar/CourtlensSidebar.tsx') },
    { name: 'production dist bundles and icons exist', ok: distChecks.slice(0, 4).every((check) => check.exists) && distChecks.filter((check) => check.relativePath.startsWith('dist/icons/')).every((check) => check.exists) },
  ]),
  feature('NSW Online Registry court-list sidebar workflow', [
    'extension/src/content/courtlist.tsx', 'extension/src/parsers/nswCourtlistParser.ts', 'fixtures/courtlist.html', 'scripts/extension_load_smoke.py'
  ], [
    { name: 'court-list content script exists', ok: fileExists('extension/src/content/courtlist.tsx') },
    { name: 'court-list parser exists', ok: fileExists('extension/src/parsers/nswCourtlistParser.ts') },
    { name: 'court-list fixture exists', ok: fileExists('fixtures/courtlist.html') },
    { name: 'real extension smoke exercises Online Registry URL', ok: fileContains('scripts/extension_load_smoke.py', ['COURTLIST_URL', 'SMITH v ACME PTY LTD']) },
  ]),
  feature('NSW Caselaw sidebar workflow with judgment-body entities', [
    'extension/src/content/caselaw.tsx', 'extension/src/parsers/nswCaselawParser.ts', 'extension/src/parsers/judgmentEntityParser.ts', 'tests/unit/caselaw-entities-ui.test.tsx'
  ], [
    { name: 'caselaw content script exists', ok: fileExists('extension/src/content/caselaw.tsx') },
    { name: 'caselaw parser exists', ok: fileExists('extension/src/parsers/nswCaselawParser.ts') },
    { name: 'judgment entity parser exists', ok: fileExists('extension/src/parsers/judgmentEntityParser.ts') },
    { name: 'caselaw entity UI regression test exists', ok: fileExists('tests/unit/caselaw-entities-ui.test.tsx') },
    { name: 'real extension smoke exercises Caselaw URL', ok: fileContains('scripts/extension_load_smoke.py', ['CASELAW_URL', 'Mitchell v State of New South Wales']) },
  ]),
  feature('Entity and party extraction including optional local NER/GLiNER-compatible seam', [
    'extension/src/parsers/partyParser.ts', 'extension/src/parsers/judgmentEntityParser.ts', 'extension/src/providers/localNerProvider.ts', 'tests/unit/local-ner.test.tsx'
  ], [
    { name: 'party parser exists', ok: fileExists('extension/src/parsers/partyParser.ts') },
    { name: 'judgment entity parser exists', ok: fileExists('extension/src/parsers/judgmentEntityParser.ts') },
    { name: 'local NER provider seam exists', ok: fileExists('extension/src/providers/localNerProvider.ts') },
    { name: 'local NER message route exists', ok: fileContains('extension/src/background/messageHandler.ts', ['COURTLENS_EXTRACT_ENTITIES']) },
    { name: 'manifest grants loopback-only local NER hosts', ok: fileContains('extension/public/manifest.json', ['http://127.0.0.1/*', 'http://localhost/*']) },
    { name: 'local NER provider rejects non-loopback endpoints', ok: fileContains('extension/src/providers/localNerProvider.ts', ['assertLoopbackNerEndpoint', '127.0.0.1', 'localhost']) },
    { name: 'real extension smoke exercises local NER enhancement', ok: fileContains('scripts/extension_load_smoke.py', ['Local NER endpoint', 'Jane Citizen', 'local NER enhancement']) },
    { name: 'local NER tests exist', ok: fileExists('tests/unit/local-ner.test.tsx') },
  ]),
  feature('Research provider search: Argus Delta, News, ABN, Federal Court, NSW Caselaw', [
    'extension/src/core/searchRouter.ts', 'extension/src/providers/argusDeltaProvider.ts', 'extension/src/providers/newsProvider.ts', 'extension/src/providers/abnProvider.ts', 'extension/src/providers/htmlSearchProvider.ts', 'scripts/extension_load_smoke.py'
  ], [
    { name: 'search router lists all providers', ok: fileContains('extension/src/core/searchRouter.ts', ['argus-delta', 'news', 'abn', 'federal-court', 'nsw-caselaw']) },
    { name: 'all provider modules exist', ok: ['argusDeltaProvider.ts', 'newsProvider.ts', 'abnProvider.ts', 'htmlSearchProvider.ts'].every((name) => fileExists(`extension/src/providers/${name}`)) },
    { name: 'real extension smoke exercises all provider buttons', ok: fileContains('scripts/extension_load_smoke.py', ['Search Argus Delta', 'Search news', 'Search federal-court', 'Search nsw-caselaw', 'Search abn']) },
    { name: 'live smoke covers public provider endpoints and optional credentialed ABN name search', ok: fileContains('scripts/live_smoke.mjs', ['Google News RSS', 'NSW Caselaw search', 'Federal Court endpoint', 'ABN current details page', 'ABN history details page', 'ABN name search', 'ABN_GUID']) },
  ]),
  feature('ABN current/history expansion workflow', [
    'extension/src/providers/abnProvider.ts', 'extension/src/background/messageHandler.ts', 'tests/unit/abn-history.test.ts', 'tests/unit/abn-history-ui.test.tsx'
  ], [
    { name: 'ABN current/history functions exist', ok: fileContains('extension/src/providers/abnProvider.ts', ['buildAbnCurrentPageUrl', 'buildAbnHistoryPageUrl', 'fetchAbnHistoryDetails']) },
    { name: 'background exposes ABN history route', ok: fileContains('extension/src/background/messageHandler.ts', ['COURTLENS_ABN_HISTORY_DETAILS']) },
    { name: 'sidebar has Show ABN history action', ok: fileContains('extension/src/sidebar/CourtlensSidebar.tsx', ['Show ABN history']) },
    { name: 'ABN history tests exist', ok: fileExists('tests/unit/abn-history.test.ts') && fileExists('tests/unit/abn-history-ui.test.tsx') },
    { name: 'real extension smoke verifies ABN history', ok: fileContains('scripts/extension_load_smoke.py', ['ABN history loaded', 'Active from 01 Jan 2020']) },
  ]),
  feature('Document application payload and deterministic PDF generation', [
    'extension/src/documents/documentApplication.ts', 'extension/src/documents/pdfGeneration.ts', 'extension/public/forms/*.pdf', 'tests/unit/pdf-determinism.test.ts'
  ], [
    { name: 'document payload module exists', ok: fileExists('extension/src/documents/documentApplication.ts') },
    { name: 'PDF generation module exists', ok: fileExists('extension/src/documents/pdfGeneration.ts') },
    { name: 'real PDF templates exist', ok: fileExists('extension/public/forms/access_application_2026.pdf') && fileExists('extension/public/forms/application_non_party_access.pdf') },
    { name: 'background exposes PDF generation route', ok: fileContains('extension/src/background/messageHandler.ts', ['COURTLENS_GENERATE_DOCUMENTS']) },
    { name: 'PDF determinism test exists', ok: fileExists('tests/unit/pdf-determinism.test.ts') },
    { name: 'real extension smoke verifies document generation', ok: fileContains('scripts/extension_load_smoke.py', ['Generate PDFs', '_media_access_2026.pdf']) },
  ]),
  feature('Gmail compose handoff', [
    'extension/src/documents/gmailCompose.ts', 'tests/unit/gmail-compose.test.ts', 'tests/unit/gmail-compose-ui.test.tsx'
  ], [
    { name: 'Gmail compose module exists', ok: fileExists('extension/src/documents/gmailCompose.ts') },
    { name: 'background exposes Gmail route', ok: fileContains('extension/src/background/messageHandler.ts', ['COURTLENS_OPEN_GMAIL_DRAFT']) },
    { name: 'sidebar exposes Gmail action', ok: fileContains('extension/src/sidebar/CourtlensSidebar.tsx', ['Open Gmail draft']) },
    { name: 'Gmail tests exist', ok: fileExists('tests/unit/gmail-compose.test.ts') && fileExists('tests/unit/gmail-compose-ui.test.tsx') },
    { name: 'real extension smoke verifies Gmail handoff', ok: fileContains('scripts/extension_load_smoke.py', ['Gmail compose handoff', 'Open Gmail draft', 'chrome.tabs.create']) || fileContains('scripts/extension_load_smoke.py', ['Gmail compose handoff', 'Open Gmail draft', 'expect_page']) },
  ]),
  feature('Settings/profile/secrets handling', [
    'extension/src/background/messageHandler.ts', 'extension/src/sidebar/CourtlensSidebar.tsx', 'scripts/secret_audit.mjs', 'tests/unit/settings-ui.test.tsx'
  ], [
    { name: 'settings save/get routes exist', ok: fileContains('extension/src/background/messageHandler.ts', ['COURTLENS_SAVE_SETTINGS', 'COURTLENS_GET_SETTINGS']) },
    { name: 'settings UI has token/ABN/applicant fields', ok: fileContains('extension/src/sidebar/CourtlensSidebar.tsx', ['Argus Delta token', 'ABN GUID', 'Applicant email']) },
    { name: 'secret audit script exists', ok: fileExists('scripts/secret_audit.mjs') },
    { name: 'settings UI test exists', ok: fileExists('tests/unit/settings-ui.test.tsx') },
    { name: 'real extension smoke verifies settings save/mask/persist', ok: fileContains('scripts/extension_load_smoke.py', ['Settings save/mask/persist', 'courtlens-smoke-token-do-not-leak', 'chrome.storage.local']) },
  ]),
  feature('Total smoke, CI, release packaging, provenance, and release cleanliness', [
    'scripts/smoke.mjs', 'scripts/live_smoke.mjs', 'scripts/live_extension_smoke.py', 'scripts/release_extension_smoke.py', 'scripts/package_extension.mjs', 'scripts/package_determinism.mjs', 'scripts/verify_ci_artifact_parity.mjs', 'scripts/completion_audit.mjs', '.github/workflows/courtlens-v2.yml'
  ], [
    { name: 'all smoke scripts exist', ok: ['smoke.mjs', 'live_smoke.mjs', 'live_extension_smoke.py', 'release_extension_smoke.py', 'operator_live_smoke.py'].every((name) => fileExists(`scripts/${name}`)) },
    { name: 'packaging and determinism scripts exist', ok: fileExists('scripts/package_extension.mjs') && fileExists('scripts/package_determinism.mjs') },
    { name: 'CI artifact parity verifier exists and is documented', ok: fileContains('scripts/verify_ci_artifact_parity.mjs', ['gh', 'run', 'download', 'SHA256SUMS', 'ci-artifact-parity.json', 'live-smoke credentialed provider status']) && fileContains('package.json', ['verify:ci-artifact-parity']) && fileContains('docs/release-readiness.md', ['verify:ci-artifact-parity', 'artifacts/ci-artifact-parity.json', 'live-smoke.json']) },
    { name: 'completion audit exists and records unresolved manual gates', ok: fileContains('scripts/completion_audit.mjs', ['completion-audit.json', 'ci-artifact-parity.json', 'live-smoke.json', 'operator-live-smoke.json', 'credentialedProviderSmoke', 'operatorNswWorkflowSmoke']) && fileContains('package.json', ['audit:completion']) && fileContains('docs/release-readiness.md', ['npm run audit:completion']) },
    { name: 'CI workflow exists at repository root', ok: existsSync(join(root, '..', '.github/workflows/courtlens-v2.yml')) },
    { name: 'CI workflow passes optional live-smoke secrets to delivery and live jobs', ok: fileContains('../.github/workflows/courtlens-v2.yml', ['workflow_dispatch:', 'ARGUS_DELTA_TOKEN: ${{ secrets.ARGUS_DELTA_TOKEN }}', 'ABN_GUID: ${{ secrets.ABN_GUID }}', 'COURTLENS_ABN_GUID: ${{ secrets.COURTLENS_ABN_GUID }}', 'Live provider smoke (optional secrets)']) },
    { name: 'release zip is clean and non-empty', ok: archiveReleaseClean && archiveSizeBytes > 0 },
    { name: 'release zip includes all icon sizes', ok: ['icons/icon-16.png', 'icons/icon-32.png', 'icons/icon-48.png', 'icons/icon-128.png'].every((entry) => archiveEntries.includes(entry)) },
    { name: 'delivery audit gate includes release extension smoke and secret audit', ok: gateOk('release-extension-smoke') && gateOk('release-secret-audit') },
  ]),
  feature('User-facing documentation and operator handoff', [
    'README.md', 'docs/architecture.md', 'docs/providers.md', 'docs/document-applications.md', 'docs/privacy-security.md', 'docs/smoke-testing.md', 'docs/web-store-listing.md', 'docs/manual-verification.md', 'artifacts/screenshots/*.png'
  ], [
    { name: 'README exists', ok: fileExists('README.md') },
    { name: 'core docs exist', ok: ['architecture.md', 'providers.md', 'document-applications.md', 'privacy-security.md', 'smoke-testing.md', 'release-readiness.md', 'web-store-listing.md', 'manual-verification.md'].every((name) => fileExists(`docs/${name}`)) },
    { name: 'smoke docs include operator-assisted path', ok: fileContains('docs/smoke-testing.md', ['Operator-assisted live Chrome smoke', 'npm run smoke:operator', 'docs/manual-verification.md']) },
    { name: 'release readiness doc includes Web Store permission and upload checklist', ok: fileContains('docs/release-readiness.md', ['Permission justification', 'Data use disclosure draft', 'Final upload checklist', 'archive.sha256', 'npm run audit:release-readiness', 'docs/web-store-listing.md']) },
    { name: 'Chrome Web Store listing handoff covers listing copy, privacy, permissions, screenshots, and QA', ok: fileContains('docs/web-store-listing.md', ['Chrome Web Store listing draft', 'Long description', 'Permission justification', 'Privacy disclosure draft', 'Single-purpose statement', 'Remote code / MV3 policy statement', 'Screenshot guidance', 'npm run verify:ci-artifact-parity']) },
    { name: 'manual verification runbook covers credentialed and operator gates without secrets', ok: fileContains('docs/manual-verification.md', ['Manual and credentialed verification runbook', 'Credentialed Argus smoke', 'Credentialed ABN name-search smoke', 'Operator NSW workflow smoke', 'Do not paste secrets']) },
    { name: 'release screenshots are generated from non-sensitive fixtures', ok: gateOk('release-screenshot-capture') && screenshotChecks.every((check) => check.exists) },
    { name: 'release readiness verifier exists and writes evidence JSON', ok: fileContains('scripts/release_readiness_audit.mjs', ['release-readiness.json', 'writeFileSync']) },
    { name: 'release checksums writer exists and covers ZIP, evidence JSON, screenshots, and optional manual/parity/smoke evidence', ok: fileContains('scripts/write_checksums.mjs', ['SHA256SUMS', 'argus-delta-courtlens.zip', 'delivery-audit.json', 'release-readiness.json', 'live-smoke.json', 'operator-live-smoke.json', 'ci-artifact-parity.json', 'completion-audit.json', 'screenshots/01-overview.png', 'screenshots/04-settings.png']) },
    { name: 'README lists final delivery gates', ok: fileContains('README.md', ['npm run package:extension', 'npm run audit:delivery', 'npm run audit:release-readiness', 'npm run audit:completion', 'npm run write:checksums']) },
  ]),
];
const featureMatrixOk = featureMatrix.every((item) => item.status === 'pass');

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
    requirement: 'Chrome MV3 extension policy audit passes with scoped permissions and no remote-code patterns',
    evidence: ['npm run audit:policy', 'scripts/extension_policy_audit.mjs', 'dist/manifest.json'],
    status: gates.find((gate) => gate.label === 'extension-policy-audit')?.ok ? 'pass' : 'fail',
  },
  {
    requirement: 'Browser fixture smoke and real unpacked-extension smoke against routed NSW URLs',
    evidence: ['npm run smoke', 'scripts/browser_smoke.py', 'scripts/extension_load_smoke.py'],
    status: gates.find((gate) => gate.label === 'browser-and-extension-smoke')?.ok ? 'pass' : 'fail',
  },
  {
    requirement: 'Live provider smoke for non-secret endpoints plus optional authenticated Argus and ABN name-search checks',
    evidence: [
      'npm run smoke:live',
      argusLiveCredentialPresent ? 'ARGUS_DELTA_TOKEN present' : 'ARGUS_DELTA_TOKEN absent; authenticated Argus branch skipped',
      abnLiveCredentialPresent ? 'ABN_GUID/COURTLENS_ABN_GUID present' : 'ABN_GUID/COURTLENS_ABN_GUID absent; ABN name-search branch skipped',
    ],
    status: gates.find((gate) => gate.label === 'live-provider-smoke')?.ok ? (optionalLiveCredentialsPresent ? 'pass' : 'partial-external-credential-needed') : 'fail',
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
    requirement: 'Release archive packaging is byte-deterministic for the same build output',
    evidence: ['npm run audit:package-determinism', 'scripts/package_determinism.mjs'],
    status: gates.find((gate) => gate.label === 'package-determinism-audit')?.ok ? 'pass' : 'fail',
  },
  {
    requirement: 'Extracted release archive loads as the real Chrome extension and passes routed NSW workflow smoke',
    evidence: ['npm run smoke:release-extension', 'scripts/release_extension_smoke.py', 'artifacts/argus-delta-courtlens.zip'],
    status: gates.find((gate) => gate.label === 'release-extension-smoke')?.ok ? 'pass' : 'fail',
  },
  {
    requirement: 'Source tree, built dist, and release archive pass secret-leak audit',
    evidence: ['npm run audit:secrets', 'scripts/secret_audit.mjs', 'source/docs/tests/scripts', 'dist/', 'artifacts/argus-delta-courtlens.zip'],
    status: gates.find((gate) => gate.label === 'release-secret-audit')?.ok ? 'pass' : 'fail',
  },
  {
    requirement: 'Prompt-to-artifact feature matrix covers every named Courtlens deliverable',
    evidence: ['delivery-audit.json.featureMatrix', 'source files', 'tests', 'smoke scripts', 'release artifact'],
    status: featureMatrixOk ? 'pass' : 'fail',
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
  screenshotChecks,
  featureMatrix,
  criteria,
  externalOrManualGates: criteria.filter((item) => item.status.includes('external') || item.status.includes('manual')),
};

mkdirSync(artifactsDir, { recursive: true });
writeFileSync(auditPath, `${JSON.stringify(audit, null, 2)}\n`, 'utf8');
console.log(`\nDelivery audit written to ${auditPath}`);

if (!automatedOk || !dependencySpecsPinned || !archiveExists || archiveSizeBytes === 0 || !archiveReleaseClean || distChecks.some((check) => !check.exists) || screenshotChecks.some((check) => !check.exists) || !featureMatrixOk) {
  process.exit(1);
}

if (audit.externalOrManualGates.length > 0) {
  console.log('Delivery audit note: automated gates passed, but external/manual gates remain recorded in the audit JSON.');
}
