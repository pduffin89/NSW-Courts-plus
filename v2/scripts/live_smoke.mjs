const base = process.env.ARGUS_DELTA_BASE_URL || 'https://be-api.argusdelta.com';
const token = process.env.ARGUS_DELTA_TOKEN || '';

async function expectStatus(label, url, init, expected) {
  const response = await fetch(url, init);
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
