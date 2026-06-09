const base = process.env.ARGUS_DELTA_BASE_URL || 'https://be-api.argusdelta.com';
const token = process.env.ARGUS_DELTA_TOKEN || '';
const timeout = 15_000;

async function expectStatus(label, url, init, expected) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeout), ...init });
  if (response.status !== expected) {
    throw new Error(`${label} expected HTTP ${expected}, got ${response.status}`);
  }
  return response;
}

function summarizeItems(payload) {
  const items = Array.isArray(payload.items) ? payload.items : [];
  return { count: items.length, hasMore: Boolean(payload.hasMore), nextOffset: payload.nextOffset ?? null };
}

const health = await expectStatus('Argus health', `${base}/health`, { headers: { Accept: 'application/json' } }, 200);
const healthPayload = await health.json();
if (healthPayload.ok !== true) throw new Error('Argus health did not return ok=true');
console.log('Live smoke: Argus health ok');

const unauth = await expectStatus(
  'Argus unauthenticated search',
  `${base}/public/court-lists/search?query=akram&limit=1&offset=0`,
  { headers: { Accept: 'application/json' } },
  401
);
const unauthPayload = await unauth.json();
if (unauthPayload.ok !== false) throw new Error('Unauthenticated search did not return ok=false');
console.log('Live smoke: Argus unauthenticated search rejected as expected');

const news = await expectStatus(
  'Google News RSS',
  'https://news.google.com/rss/search?q=Smith&hl=en-AU&gl=AU&ceid=AU:en',
  { headers: { Accept: 'application/rss+xml' } },
  200
);
const newsText = await news.text();
if (!newsText.includes('<rss')) throw new Error('Google News RSS did not return RSS content');
console.log('Live smoke: Google News RSS ok');

const caselaw = await expectStatus(
  'NSW Caselaw search',
  'https://www.caselaw.nsw.gov.au/search?query=Smith&page=1',
  { headers: { Accept: 'text/html' } },
  200
);
const caselawText = await caselaw.text();
if (!caselawText.toLowerCase().includes('html')) throw new Error('NSW Caselaw did not return HTML content');
console.log('Live smoke: NSW Caselaw search ok');

const federal = await fetch('https://search.judgments.fedcourt.gov.au/s/search.html?query_sand=Smith&start_rank=1', {
  signal: AbortSignal.timeout(timeout),
  headers: { Accept: 'text/html' }
});
if (![200, 403].includes(federal.status)) throw new Error(`Federal Court live smoke expected 200 or environment 403, got ${federal.status}`);
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
console.log('Live smoke: ABN history details page ok');

if (!token) {
  console.log('Live smoke: ARGUS_DELTA_TOKEN not set; authenticated Argus search skipped.');
  process.exit(0);
}

const auth = await expectStatus(
  'Argus authenticated search',
  `${base}/public/court-lists/search?query=${encodeURIComponent('Andrew James Mitchell')}&limit=3&offset=0`,
  { headers: { Accept: 'application/json', Authorization: `Bearer ${token}` } },
  200
);
console.log('Live smoke: Argus authenticated search ok', summarizeItems(await auth.json()));

const shortQuery = await expectStatus(
  'Argus short-query validation',
  `${base}/public/court-lists/search?query=a&limit=1&offset=0`,
  { headers: { Accept: 'application/json', Authorization: `Bearer ${token}` } },
  400
);
const shortPayload = await shortQuery.json();
if (shortPayload.ok !== false) throw new Error('Short-query validation did not return ok=false');
console.log('Live smoke: Argus short-query validation ok');
