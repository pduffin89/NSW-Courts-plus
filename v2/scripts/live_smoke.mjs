import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const artifactsDir = join(root, 'artifacts');
const evidencePath = join(artifactsDir, 'live-smoke.json');
const base = process.env.ARGUS_DELTA_BASE_URL || 'https://be-api.argusdelta.com';
const token = process.env.ARGUS_DELTA_TOKEN || '';
const abnGuid = process.env.ABN_GUID || process.env.COURTLENS_ABN_GUID || '';
const timeout = 15_000;
const maxAttempts = 3;
const checks = [];

function record(name, status, details = {}) {
  checks.push({ name, status, ...details });
}

function gitHead() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

function writeEvidence() {
  const authenticatedArgus = checks.find((check) => check.name === 'argus-authenticated-search')?.status === 'pass'
    && checks.find((check) => check.name === 'argus-short-query-validation')?.status === 'pass';
  const credentialedAbn = checks.find((check) => check.name === 'abn-name-search')?.status === 'pass';
  const evidence = {
    generatedAt: new Date().toISOString(),
    status: 'pass',
    command: 'npm run smoke:live',
    gitHead: gitHead(),
    credentialsPresent: {
      argusDeltaToken: Boolean(token),
      abnGuid: Boolean(abnGuid),
    },
    credentialedProviderSmoke: {
      status: authenticatedArgus && credentialedAbn ? 'pass' : 'partial-external-credential-needed',
      authenticatedArgus,
      credentialedAbn,
    },
    checks,
  };
  mkdirSync(artifactsDir, { recursive: true });
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function expectStatuses(label, url, init, expectedStatuses) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(timeout), ...init });
      if (!expectedStatuses.includes(response.status)) {
        throw new Error(`${label} expected HTTP ${expectedStatuses.join(' or ')}, got ${response.status}`);
      }
      if (attempt > 1) console.log(`Live smoke: ${label} passed on retry ${attempt}`);
      return response;
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) break;
      console.log(`Live smoke: ${label} attempt ${attempt} failed (${error.name || 'Error'}: ${error.message}); retrying...`);
      await sleep(750 * attempt);
    }
  }
  throw lastError;
}

async function expectStatus(label, url, init, expected) {
  return expectStatuses(label, url, init, [expected]);
}

function summarizeItems(payload) {
  const items = Array.isArray(payload.items) ? payload.items : [];
  return { count: items.length, hasMore: Boolean(payload.hasMore), nextOffset: payload.nextOffset ?? null };
}

const health = await expectStatus('Argus health', `${base}/health`, { headers: { Accept: 'application/json' } }, 200);
const healthPayload = await health.json();
if (healthPayload.ok !== true) throw new Error('Argus health did not return ok=true');
record('argus-health', 'pass', { baseUrl: base });
console.log('Live smoke: Argus health ok');

const unauth = await expectStatus(
  'Argus unauthenticated search',
  `${base}/public/court-lists/search?query=akram&limit=1&offset=0`,
  { headers: { Accept: 'application/json' } },
  401
);
const unauthPayload = await unauth.json();
if (unauthPayload.ok !== false) throw new Error('Unauthenticated search did not return ok=false');
record('argus-unauthenticated-search-rejected', 'pass');
console.log('Live smoke: Argus unauthenticated search rejected as expected');

const news = await expectStatus(
  'Google News RSS',
  'https://news.google.com/rss/search?q=Smith&hl=en-AU&gl=AU&ceid=AU:en',
  { headers: { Accept: 'application/rss+xml' } },
  200
);
const newsText = await news.text();
if (!newsText.includes('<rss')) throw new Error('Google News RSS did not return RSS content');
record('google-news-rss', 'pass');
console.log('Live smoke: Google News RSS ok');

const caselaw = await expectStatus(
  'NSW Caselaw search',
  'https://www.caselaw.nsw.gov.au/search?query=Smith&page=1',
  { headers: { Accept: 'text/html' } },
  200
);
const caselawText = await caselaw.text();
if (!caselawText.toLowerCase().includes('html')) throw new Error('NSW Caselaw did not return HTML content');
record('nsw-caselaw-search', 'pass');
console.log('Live smoke: NSW Caselaw search ok');

const federal = await expectStatuses('Federal Court endpoint', 'https://search.judgments.fedcourt.gov.au/s/search.html?query_sand=Smith&start_rank=1', {
  headers: { Accept: 'text/html' }
}, [200, 403]);
record('federal-court-endpoint', 'pass', { httpStatus: federal.status });
console.log(`Live smoke: Federal Court endpoint reachable (${federal.status})`);

const abn = '51824753556';
const abnCurrent = await expectStatus(
  'ABN current details page',
  `https://abr.business.gov.au/ABN/View?id=${abn}`,
  { headers: { Accept: 'text/html' } },
  200
);
const abnCurrentText = await abnCurrent.text();
if (!abnCurrentText.includes('Entity name:') || !abnCurrentText.includes('AUSTRALIAN TAXATION OFFICE')) {
  throw new Error('ABN current details page did not include expected public ATO entity markers');
}
record('abn-current-details-page', 'pass', { abn });
console.log('Live smoke: ABN current details page ok');

const abnHistory = await expectStatus(
  'ABN history details page',
  `https://abr.business.gov.au/AbnHistory/View?id=${abn}`,
  { headers: { Accept: 'text/html' } },
  200
);
const abnHistoryText = await abnHistory.text();
if (!abnHistoryText.includes('Entity name') || !abnHistoryText.includes('AUSTRALIAN TAXATION OFFICE')) {
  throw new Error('ABN history details page did not include expected public ATO entity markers');
}
record('abn-history-details-page', 'pass', { abn });
console.log('Live smoke: ABN history details page ok');

if (abnGuid) {
  const abnSearchUrl = new URL('https://abr.business.gov.au/json/MatchingNames.aspx');
  abnSearchUrl.searchParams.set('name', 'Australian Taxation Office');
  abnSearchUrl.searchParams.set('maxResults', '5');
  abnSearchUrl.searchParams.set('guid', abnGuid);
  const abnSearch = await expectStatus(
    'ABN name search',
    abnSearchUrl.toString(),
    { headers: { Accept: 'application/javascript, application/json, text/plain' } },
    200
  );
  const abnSearchText = await abnSearch.text();
  const start = abnSearchText.indexOf('(');
  const end = abnSearchText.lastIndexOf(')');
  const abnPayload = JSON.parse(start >= 0 && end > start ? abnSearchText.slice(start + 1, end) : abnSearchText);
  if (abnPayload?.Message) throw new Error(`ABN name search returned message: ${abnPayload.Message}`);
  const names = Array.isArray(abnPayload?.Names) ? abnPayload.Names : [];
  if (!names.some((row) => String(row?.Abn || '') === abn && String(row?.Name || '').includes('AUSTRALIAN TAXATION OFFICE'))) {
    throw new Error('ABN name search did not return expected public ATO record');
  }
  record('abn-name-search', 'pass', { expectedPublicAbnReturned: true });
  console.log('Live smoke: ABN name search ok');
} else {
  record('abn-name-search', 'skipped-external-credential-needed', { reason: 'ABN_GUID/COURTLENS_ABN_GUID not set' });
  console.log('Live smoke: ABN_GUID/COURTLENS_ABN_GUID not set; ABN name search skipped.');
}

if (token) {
  const auth = await expectStatus(
    'Argus authenticated search',
    `${base}/public/court-lists/search?query=${encodeURIComponent('Andrew James Mitchell')}&limit=3&offset=0`,
    { headers: { Accept: 'application/json', Authorization: `Bearer ${token}` } },
    200
  );
  const authSummary = summarizeItems(await auth.json());
  record('argus-authenticated-search', 'pass', authSummary);
  console.log('Live smoke: Argus authenticated search ok', authSummary);

  const shortQuery = await expectStatus(
    'Argus short-query validation',
    `${base}/public/court-lists/search?query=a&limit=1&offset=0`,
    { headers: { Accept: 'application/json', Authorization: `Bearer ${token}` } },
    400
  );
  const shortPayload = await shortQuery.json();
  if (shortPayload.ok !== false) throw new Error('Short-query validation did not return ok=false');
  record('argus-short-query-validation', 'pass');
  console.log('Live smoke: Argus short-query validation ok');
} else {
  record('argus-authenticated-search', 'skipped-external-credential-needed', { reason: 'ARGUS_DELTA_TOKEN not set' });
  record('argus-short-query-validation', 'skipped-external-credential-needed', { reason: 'ARGUS_DELTA_TOKEN not set' });
  console.log('Live smoke: ARGUS_DELTA_TOKEN not set; authenticated Argus search skipped.');
}

writeEvidence();
console.log(`Live smoke evidence written to ${evidencePath}`);
