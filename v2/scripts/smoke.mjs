import { existsSync, readFileSync } from 'node:fs';
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
  'docs/smoke-testing.md'
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
if (!manifest.content_scripts.some((script) => script.matches.includes('https://www.caselaw.nsw.gov.au/decision/*'))) throw new Error('Caselaw content script missing');

const background = readFileSync(join(root, 'dist/background.js'), 'utf8');
if (background.includes('Bearer secret') || background.includes('argusDeltaToken:"')) throw new Error('Potential hardcoded secret in background bundle');

const courtlist = readFileSync(join(root, 'dist/courtlist.js'), 'utf8');
if (!courtlist.includes('Courtlens')) throw new Error('Courtlist launcher missing from bundle');

console.log('Smoke passed: manifest, bundles, assets, docs, and secret guard verified.');
