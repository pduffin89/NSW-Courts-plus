import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const dist = join(root, 'dist');
const manifestPath = join(dist, 'manifest.json');

const expectedPermissions = ['storage'];
const expectedContentSecurityPolicy = { extension_pages: "script-src 'self'; object-src 'none'" };
const forbiddenManifestKeys = [
  'externally_connectable',
  'optional_permissions',
  'optional_host_permissions',
  'oauth2',
  'key',
  'update_url',
];
const expectedHostPermissions = [
  'http://127.0.0.1/*',
  'http://localhost/*',
  'https://abr.business.gov.au/*',
  'https://be-api.argusdelta.com/*',
  'https://news.google.com/*',
  'https://search.judgments.fedcourt.gov.au/*',
  'https://www.caselaw.nsw.gov.au/*',
];
const expectedContentScripts = new Map([
  ['courtlist.js', ['https://onlineregistry.lawlink.nsw.gov.au/content/court-lists*']],
  ['caselaw.js', ['https://www.caselaw.nsw.gov.au/decision/*', 'https://www.caselaw.nsw.gov.au/search*']],
]);
const expectedIcons = {
  16: 'icons/icon-16.png',
  32: 'icons/icon-32.png',
  48: 'icons/icon-48.png',
  128: 'icons/icon-128.png',
};
const forbiddenUrlPatterns = ['<all_urls>', 'http://*/*', 'https://*/*', '*://*/*'];
const forbiddenBundlePatterns = [
  { label: 'eval()', pattern: /\beval\s*\(/ },
  { label: 'new Function()', pattern: /\bnew\s+Function\s*\(/ },
  { label: 'unsafe-eval', pattern: /unsafe-eval/ },
  { label: 'document.write()', pattern: /\bdocument\.write\s*\(/ },
  { label: 'remote script tag', pattern: /<script[^>]+src=["']https?:\/\//i },
  { label: 'remote importScripts()', pattern: /\bimportScripts\s*\(\s*["']https?:\/\//i },
  { label: 'remote dynamic import()', pattern: /\bimport\s*\(\s*["']https?:\/\//i },
  { label: 'remote Worker()', pattern: /\b(?:new\s+)?(?:Shared)?Worker\s*\(\s*["']https?:\/\//i },
  { label: 'WebAssembly.compile()', pattern: /\bWebAssembly\.compile\s*\(/ },
  { label: 'WebAssembly.instantiate()', pattern: /\bWebAssembly\.instantiate\s*\(/ },
];

function fail(message) {
  throw new Error(`Extension policy audit failed: ${message}`);
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

function walkFiles(dir, prefix = '') {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const relativePath = prefix ? `${prefix}/${entry}` : entry;
    if (statSync(fullPath).isDirectory()) files.push(...walkFiles(fullPath, relativePath));
    else files.push({ fullPath, relativePath });
  }
  return files;
}

if (!existsSync(manifestPath)) fail('dist/manifest.json missing; run npm run build first');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

if (manifest.manifest_version !== 3) fail(`manifest_version must be 3, got ${manifest.manifest_version}`);
if (manifest.name !== 'Argus Delta Courtlens') fail(`unexpected extension name ${manifest.name}`);
if (manifest.background?.service_worker !== 'background.js') fail('background service worker must be background.js');
if (manifest.background?.type !== 'module') fail('background service worker must be type=module');
for (const key of forbiddenManifestKeys) {
  if (key in manifest) fail(`${key} must not be declared for this least-privilege release`);
}
if (JSON.stringify(manifest.content_security_policy || {}) !== JSON.stringify(expectedContentSecurityPolicy)) {
  fail(`content_security_policy mismatch. expected ${JSON.stringify(expectedContentSecurityPolicy)}, got ${JSON.stringify(manifest.content_security_policy || {})}`);
}
if (manifest.content_security_policy.extension_pages.includes('unsafe-eval')) fail('extension_pages CSP contains unsafe-eval');
if (JSON.stringify(manifest.icons || {}) !== JSON.stringify(expectedIcons)) fail(`icons mismatch. expected ${JSON.stringify(expectedIcons)}, got ${JSON.stringify(manifest.icons || {})}`);
if (JSON.stringify(manifest.action?.default_icon || {}) !== JSON.stringify(expectedIcons)) fail('action.default_icon must match top-level icons');
for (const [size, relativePath] of Object.entries(expectedIcons)) {
  const iconPath = join(dist, relativePath);
  if (!existsSync(iconPath)) fail(`missing icon ${relativePath}`);
  const icon = readFileSync(iconPath);
  const pngSignature = '89504e470d0a1a0a';
  if (icon.subarray(0, 8).toString('hex') !== pngSignature) fail(`${relativePath} is not a PNG file`);
  const width = icon.readUInt32BE(16);
  const height = icon.readUInt32BE(20);
  if (width !== Number(size) || height !== Number(size)) fail(`${relativePath} dimensions expected ${size}x${size}, got ${width}x${height}`);
}

assertExactSet('permissions', manifest.permissions, expectedPermissions);
assertExactSet('host_permissions', manifest.host_permissions, expectedHostPermissions);
if ((manifest.web_accessible_resources || []).length !== 0) fail('web_accessible_resources must be empty; Courtlens keeps bundled assets private to extension contexts');

const allUrlGrants = [
  ...(manifest.host_permissions || []),
  ...((manifest.content_scripts || []).flatMap((script) => script.matches || [])),
  ...((manifest.web_accessible_resources || []).flatMap((resource) => resource.matches || [])),
];
for (const grant of allUrlGrants) {
  if (forbiddenUrlPatterns.includes(grant)) fail(`broad URL grant is forbidden: ${grant}`);
  const isLoopbackHttpGrant = grant === 'http://127.0.0.1/*' || grant === 'http://localhost/*';
  if (grant.startsWith('http://') && !isLoopbackHttpGrant) fail(`insecure HTTP grant is forbidden outside loopback local NER: ${grant}`);
}

const contentScripts = manifest.content_scripts || [];
for (const [jsFile, expectedMatches] of expectedContentScripts) {
  const script = contentScripts.find((candidate) => JSON.stringify(candidate.js || []) === JSON.stringify([jsFile]));
  if (!script) fail(`missing content script for ${jsFile}`);
  assertExactSet(`${jsFile} matches`, script.matches, expectedMatches);
  if (script.run_at !== 'document_idle') fail(`${jsFile} must run at document_idle`);
}
if (contentScripts.length !== expectedContentScripts.size) fail(`unexpected content script count ${contentScripts.length}`);

const jsFiles = walkFiles(dist).filter((file) => file.relativePath.endsWith('.js'));
for (const file of jsFiles) {
  const source = readFileSync(file.fullPath, 'utf8');
  for (const forbidden of forbiddenBundlePatterns) {
    if (forbidden.pattern.test(source)) fail(`${file.relativePath} contains ${forbidden.label}`);
  }
}

console.log(`Extension policy audit passed: MV3 manifest, strict CSP, icons, exact permissions, no optional/external surfaces, no web-accessible resources, scoped hosts, and ${jsFiles.length} JS bundle(s) verified.`);
