import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const root = process.cwd();
const required = [
  'dist/manifest.json',
  'dist/background.js',
  'dist/courtlist.js',
  'dist/caselaw.js',
  'dist/forms/access_application_2026.pdf',
  'dist/forms/application_non_party_access.pdf',
  'dist/vendor/pdf-lib.min.js',
  'README.md',
  'CHANGELOG.md',
  'docs/architecture.md',
  'docs/providers.md',
  'docs/argus-delta-api.md',
  'docs/document-applications.md',
  'docs/smoke-testing.md',
  'docs/privacy-security.md',
  'docs/release-readiness.md'
];

const missing = required.filter((path) => !existsSync(join(root, path)));
if (missing.length) {
  console.error('Smoke failed: missing required artifacts');
  for (const path of missing) console.error(`- ${path}`);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(join(root, 'dist/manifest.json'), 'utf8'));
if (manifest.name !== 'Argus Delta Courtlens') throw new Error('Manifest name mismatch');
if (manifest.background?.service_worker !== 'background.js') throw new Error('Background worker not wired');
if (!manifest.host_permissions.includes('https://be-api.argusdelta.com/*')) throw new Error('Argus Delta host permission missing');
if (!manifest.host_permissions.includes('http://127.0.0.1/*') || !manifest.host_permissions.includes('http://localhost/*')) throw new Error('Loopback local NER host permissions missing');
if (!manifest.content_scripts.some((script) => script.matches.includes('https://www.caselaw.nsw.gov.au/decision/*'))) throw new Error('Caselaw content script missing');

const background = readFileSync(join(root, 'dist/background.js'), 'utf8');
if (background.includes('Bearer secret') || background.includes('argusDeltaToken:"')) throw new Error('Potential hardcoded secret in background bundle');

const courtlist = readFileSync(join(root, 'dist/courtlist.js'), 'utf8');
if (!courtlist.includes('Courtlens')) throw new Error('Courtlist launcher missing from bundle');

const browserSmoke = spawnSync('python3', ['scripts/browser_smoke.py'], { cwd: root, encoding: 'utf8' });
if (browserSmoke.status !== 0) {
  process.stdout.write(browserSmoke.stdout || '');
  process.stderr.write(browserSmoke.stderr || '');
  throw new Error(`Browser smoke failed with exit ${browserSmoke.status}`);
}
process.stdout.write(browserSmoke.stdout || '');

const extensionSmoke = spawnSync('python3', ['scripts/extension_load_smoke.py'], { cwd: root, encoding: 'utf8' });
if (extensionSmoke.status !== 0) {
  process.stdout.write(extensionSmoke.stdout || '');
  process.stderr.write(extensionSmoke.stderr || '');
  throw new Error(`Extension load smoke failed with exit ${extensionSmoke.status}`);
}
process.stdout.write(extensionSmoke.stdout || '');

console.log('Smoke passed: manifest, bundles, assets, docs, secret guard, browser fixture smoke, and unpacked-extension smoke verified.');
