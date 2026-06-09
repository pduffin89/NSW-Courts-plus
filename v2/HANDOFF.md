# Handoff: Argus Delta Courtlens

## Mission

Build a new Chrome extension called **Argus Delta Courtlens** in:

```text
/Users/perry/Local Projects/AD Chrome Extension/v2
```

This is a **new extension**, not a refactor of the existing GLiNER extension and not a destructive rewrite of NSW Courts+. Do not delete or overwrite the existing projects.

Courtlens should become the ultimate sidebar extension for working with NSW court material across:

- NSW Online Registry court-list website
- NSW Caselaw website / judgment pages

The user wants to eventually replace the old Court Plus extension if Courtlens successfully covers:

- document application form generation / prefilling
- court-list party research
- caselaw judgment entity extraction and research
- News search
- Argus Delta API search
- ABN search
- Federal Court search

## Critical user intent

The user is dropping the previous path of refining the GLiNER extension **inside this project**. They will keep refining GLiNER separately in the original extension.

For Courtlens, use GLiNER-style extraction only as a capability on caselaw pages: identify people, companies, government bodies, judges, legal representatives, councils, parties, and other legally meaningful entities from long judgments.

Primary product promise:

> Browse NSW court lists or NSW Caselaw, open the Courtlens sidebar, instantly understand who is in the matter, search each entity across useful sources, and pre-fill court document application forms using detected matter metadata.

## Must-follow Graphify instruction

Before broad file search, use the Graphify map at:

```text
/Users/perry/Documents/Graphify/graphify-out/graph.json
```

Read first:

```text
/Users/perry/Documents/Graphify/graphify-out/GRAPH_REPORT.md
```

Run `graphify query`, `graphify path`, or `graphify explain` from:

```text
/Users/perry/Documents/Graphify
```

Example commands already useful:

```bash
cd /Users/perry/Documents/Graphify

graphify query "AD Chrome Extension NSW courtlist caselaw document application court file number venue ABN news Argus Delta Federal Court sidebar" --graph graphify-out/graph.json --budget 7000

graphify explain "generateLocally()" --graph graphify-out/graph.json

graphify query "argus delta" --graph graphify-out/graph.json --budget 5000
```

## Existing source assets to reuse

The new `v2` directory was empty at handoff time except for this file.

The mature existing NSW Courts+ extension lives at:

```text
/Users/perry/Local Projects/AD Chrome Extension
```

Important reusable files:

| File | Reuse purpose |
|---|---|
| `extension/matter_parser.js` | Court-list matter extraction: case number, matter title, court, location, jurisdiction |
| `extension/party_parser.js` | Court-style party/name splitting and News candidate generation |
| `extension/background.js` | Working providers and local PDF/document generation code |
| `extension/content.js` | Court-list UI injection, research drawer, request-doc modal patterns |
| `extension/content.css` | Existing UI styles, useful as behavior reference but new UI should be cleaner/shadcn-like |
| `extension/forms/access_application_2026.pdf` | Supreme/media application template |
| `extension/forms/application_non_party_access.pdf` | Non-party access template |
| `extension/vendor/pdf-lib.min.js` | Local PDF generation runtime |
| `extension/vendor/fontkit.umd.min.js` | PDF fontkit runtime |
| `scripts/validate_news_party_parser.py` | Regression examples for party parsing |
| `scripts/verify_pdf_matrix.py` | Heavy PDF determinism verification in old project |

Existing parent README documents features and verification:

```text
/Users/perry/Local Projects/AD Chrome Extension/README.md
/Users/perry/Local Projects/AD Chrome Extension/PROJECT_INVENTORY.md
/Users/perry/Local Projects/AD Chrome Extension/AGENTS.md
```

## Existing provider seams from old extension

Graphify and file inspection identified these useful old-extension functions:

| Function | Source | Purpose |
|---|---|---|
| `parseNewsSearchCandidates()` | `extension/party_parser.js` | Legal party/entity candidates from matter titles |
| `buildGoogleNewsRssUrl()` | `extension/background.js`, `party_parser.js` | Google News RSS search URL |
| `handleNewsSearch()` | `extension/background.js` | Background Google News fetch |
| `handleAbnSearch()` | `extension/background.js` | ABN name/ABN lookup via ABR |
| `handleAbnHistoryDetails()` | `extension/background.js` | ABN current/history page scrape |
| `handleCaselawSearch()` | `extension/background.js` | AustLII then NSW Caselaw search |
| `handleFederalCourtSearch()` | `extension/background.js` | Federal Court Digital Law Library search |
| `generateLocally()` | `extension/background.js` | Local PDF application generation |
| `resolveCourtRecipient()` | `extension/background.js` | Email recipient routing by court |
| `composeGmailUrl()` | `extension/background.js` | Gmail compose URL |

Graphify found no direct path from `handleNewsSearch()` to `searchByName()` or from old party parser to ABN backend route. Treat this as an opportunity to build a clean provider router.

## Argus Delta API reference and test results

API doc supplied by user:

```text
/Users/perry/Documents/api-reference.md
```

Base URL:

```text
https://be-api.argusdelta.com
```

Confirmed endpoints:

```http
GET /health
GET /public/court-lists/search?query=<query>&limit=<n>&offset=<n>
```

Auth:

```http
Authorization: Bearer <token>
Accept: application/json
```

The user supplied an API token in chat. Treat it as a secret. Do **not** print it, commit it, echo it, or hardcode it in source. Prefer `chrome.storage.local` for private local use and/or a backend proxy/env var for distributable use.

### Authenticated smoke test performed

Authenticated search works.

Results observed:

| Check | Result |
|---|---|
| `GET /health` | `200`, `{ ok: true }` |
| Unauthenticated search | `401`, `{ ok: false, error: "Unauthorized" }` |
| Auth search `akram` | `200`, items returned |
| Auth search `2025/00490454` | `200`, one item returned |
| No-result query | `200`, `items: []`, `hasMore: false` |
| Short query `a` | `400`, min length validation |
| Offset pagination | works with `hasMore` and `nextOffset` |
| CORS preflight | `204`, allows `authorization,accept` headers |

Important live behavior:

- Many returned fields can be `null`, including `rowId`, `feedId`, `feedTitle`, `feedType`, `date`, `time`, `court`, `location`, and `listingType`.
- `title` and `caseNumbers` were useful in observed responses.
- Do not assume `rowId` is a stable unique UI key.
- Use composite keys or dedupe by title + case numbers + createdAt when present.
- Quoted exact queries are bad for Argus Delta:
  - `"Andrew James Mitchell"` returned zero results.
  - `Andrew James Mitchell` returned results.
- For Argus Delta, strip quotes before API call. If exact mode is enabled, apply client-side filtering/ranking rather than sending quote marks.

Suggested Argus provider behavior:

```text
display query: "Andrew James Mitchell" in exact mode
API query: Andrew James Mitchell
post-filter/rank: title/caseNumbers phrase-ish match if exact mode
```

## Product shape

Courtlens should present as a right-side sidebar on both target sites.

Suggested top-level tabs:

1. `Overview`
   - matter title
   - court
   - file/case number
   - venue/location
   - detected parties/entities grouped by type
2. `Research`
   - provider tabs/cards for News, Argus Delta, ABN, Federal Court, NSW Caselaw
   - exact/fuzzy toggle
   - per-entity action buttons
3. `Documents`
   - prefilled application form workflow
   - venue/court selection if uncertain
   - requested document options
   - generate/save/draft email
4. `Settings`
   - Argus Delta API token or proxy URL
   - ABN GUID setting if needed
   - applicant profile

Use a shadcn/Radix-inspired visual language:

- right sidebar shell
- header with site/matter status
- tabs
- cards
- badges
- scroll areas
- grouped sections
- ivory/gold/charcoal palette
- compact but readable result cards

Because this is a Chrome extension, do not assume React/shadcn is automatically available. Options:

- implement shadcn-like vanilla components with CSS variables, or
- set up a Vite/React build and bundle into the extension.

Recommendation: start with **modular vanilla JS + shadcn-like CSS** for fastest reliability unless user explicitly wants a React build.

## Architecture recommendation

Use a modular Manifest V3 extension structure, not one giant content script.

Suggested structure:

```text
v2/
  extension/
    manifest.json
    background.js
    content-courtlist.js
    content-caselaw.js
    sidebar.css
    sidebar/
      shell.js
      overview.js
      research.js
      documents.js
      settings.js
    core/
      types.js
      matter.js
      entities.js
      search-router.js
      storage.js
      config.js
    parsers/
      nsw-courtlist-parser.js
      nsw-caselaw-parser.js
      party-parser.js
      judgment-entity-parser.js
    providers/
      news-provider.js
      abn-provider.js
      argus-delta-provider.js
      federal-court-provider.js
      nsw-caselaw-provider.js
    documents/
      application-ui.js
      pdf-generation.js
      court-routing.js
    forms/
      access_application_2026.pdf
      application_non_party_access.pdf
    vendor/
      pdf-lib.min.js
      fontkit.umd.min.js
  tests/
    smoke/
    harness/
  docs/
    architecture.md
    argus-delta-api.md
    smoke-testing.md
  package.json
  README.md
```

Keep providers behind one interface:

```js
// Provider interface idea
{
  id: "argus-delta",
  label: "Argus Delta",
  accepts(candidate, context) => boolean,
  search({ candidate, query, exact, context, limit, offset }) => Promise<ResultPage>
}
```

Candidate shape idea:

```js
{
  id,
  name,
  originalText,
  type: "person" | "company" | "government" | "council" | "legal_representative" | "judge" | "party" | "unknown",
  group,
  confidence,
  source: "courtlist" | "caselaw-title" | "judgment-body" | "metadata",
  context: {
    matterTitle,
    caseNumber,
    court,
    venue,
    url
  }
}
```

Provider result shape idea:

```js
{
  providerId,
  query,
  items: [
    {
      title,
      subtitle,
      url,
      source,
      date,
      snippets,
      badges,
      raw
    }
  ],
  hasMore,
  nextOffset,
  error
}
```

## Site-specific behavior

### NSW court-list website

Target URL from old manifest:

```text
https://onlineregistry.lawlink.nsw.gov.au/content/court-lists*
```

Behavior:

- inject Courtlens action rail/button into rows
- parse matter from row
- open sidebar with matter context
- party/entity candidates from matter title
- research current parties immediately or on click
- Documents tab pre-fills application form from row fields
- support old Court Plus document generation behavior

Use old parser:

```text
/Users/perry/Local Projects/AD Chrome Extension/extension/matter_parser.js
/Users/perry/Local Projects/AD Chrome Extension/extension/party_parser.js
```

### NSW Caselaw website

Likely target URLs include:

```text
https://www.caselaw.nsw.gov.au/decision/*
https://www.caselaw.nsw.gov.au/search*
```

Behavior:

- detect actual judgment pages
- open Courtlens sidebar
- parse judgment metadata:
  - title / catchwords / court
  - file number(s)
  - judgment date
  - judge(s)
  - parties
  - citations if present
- extract entities from body:
  - current case parties
  - people
  - companies/corporate entities
  - government entities
  - local councils
  - legal representatives
  - judges
- allow one-click research across providers
- Documents tab uses detected case number and court to pre-fill application form and venue where possible

If GLiNER model bundling is heavy, stage the implementation:

1. deterministic metadata/title/body regex extraction
2. provider sidebar and document workflow
3. GLiNER/local NER integration later as a module

Do not block the entire extension on ML extraction.

## Search providers to implement

### Google News

Reuse old code patterns:

- build Google News RSS URL
- fetch in background
- parse RSS in content/sidebar or background

### ABN

Reuse old background ABN functions.

Important:

- ABN exact mode in old extension post-filters entity names by phrase.
- ABN requires an ABR GUID. Old extension likely already contains or expects `ABN_GUID` in `background.js`; do not expose credentials in docs/output.
- Consider moving ABN GUID to settings/storage like Argus token.

### Federal Court

Reuse old `buildFederalCourtSearchUrl()` and `handleFederalCourtSearch()`.

Existing endpoint:

```text
https://search.judgments.fedcourt.gov.au/s/search.html
```

Old code uses `query_sand`, pagination via `start_rank`, and returns HTML for sidebar parsing.

### NSW Caselaw

For caselaw pages, local page metadata is primary.

For provider search, old code searches AustLII first, then NSW Caselaw fallback.

### Argus Delta

New provider.

Endpoint:

```text
GET https://be-api.argusdelta.com/public/court-lists/search?query=<query>&limit=<limit>&offset=<offset>
```

Implementation notes:

- store token securely in `chrome.storage.local` or call through proxy
- never hardcode token in source
- validate query length >= 2 before calling
- strip quotes before calling
- support offset pagination
- render `title` and `caseNumbers` even if all metadata is null
- expose clear empty/error states

## Chrome extension permissions

Starting manifest should include host permissions for:

```json
[
  "https://onlineregistry.lawlink.nsw.gov.au/*",
  "https://www.caselaw.nsw.gov.au/*",
  "https://news.google.com/*",
  "https://abr.business.gov.au/*",
  "https://www.austlii.edu.au/*",
  "https://search.judgments.fedcourt.gov.au/*",
  "https://be-api.argusdelta.com/*",
  "https://mail.google.com/*"
]
```

Permissions likely needed:

```json
[
  "tabs",
  "storage",
  "alarms",
  "scripting",
  "downloads"
]
```

If the first milestone does not include Gmail attachment automation, defer `mail.google.com`, `tabs`, `alarms`, and some Gmail-specific code until document workflow integration.

## Secrets handling

Do not commit tokens or GUIDs.

Recommended settings:

```js
chrome.storage.local.set({
  argusDeltaToken: "...",
  argusDeltaProxyUrl: "",
  abnGuid: "..."
})
```

For distribution, prefer proxy mode:

```text
extension -> local/backend proxy -> Argus Delta API
```

For private local use, storage token is acceptable.

Never print token in logs. If testing in shell, construct token in memory and print only response status/counts.

## Documentation requirements

The user explicitly requested the extension be well documented.

Create at minimum:

```text
README.md
LICENSE or note if private
CHANGELOG.md
docs/architecture.md
docs/providers.md
docs/argus-delta-api.md
docs/document-applications.md
docs/smoke-testing.md
```

README should include:

- install/load unpacked steps
- supported sites
- settings/token setup
- high-level workflows
- smoke-test commands
- privacy/security note about tokens and local document generation

## Verification / smoke testing expectations

At minimum before claiming milestone complete:

```bash
node --check extension/background.js
node --check extension/content-courtlist.js
node --check extension/content-caselaw.js
```

Add harness tests for:

- court-list row parsing
- party parser candidates
- caselaw metadata extraction
- Argus Delta response normalization with nullable fields
- quote stripping for Argus provider
- provider result card normalization

If using Playwright:

- visual smoke: sidebar opens on mocked court-list page
- visual smoke: sidebar opens on mocked caselaw judgment page
- exact/fuzzy toggle updates displayed queries
- Argus provider handles empty/null-rich responses
- Documents tab pre-fills case number/court from fixture

Old project verification commands are useful references:

```bash
cd /Users/perry/Local\ Projects/AD\ Chrome\ Extension
node --check extension/background.js
node --check extension/content.js
node --check extension/matter_parser.js
python3 scripts/validate_news_party_parser.py
python3 scripts/verify_pdf_matrix.py
python3 scripts/validate_extension_pdf_generation.py
python3 scripts/build_installer.py
```

For v2, build smaller equivalents first, then port heavy PDF matrix if document generation is brought over.

## Suggested implementation milestones

### Milestone 1: Scaffold + static sidebar

- Create Manifest V3 extension in `v2/extension`.
- Add content scripts for both NSW court lists and NSW Caselaw.
- Add shadcn-like sidebar shell with tabs: Overview, Research, Documents, Settings.
- Add docs and package scripts.
- Add smoke fixture pages if useful.

### Milestone 2: Court-list support

- Port/clean `matter_parser.js` and `party_parser.js`.
- Inject row button/action rail.
- Open sidebar with matter overview and party candidate groups.
- Add provider router skeleton.

### Milestone 3: Argus Delta provider

- Add settings storage for token/proxy.
- Implement background `ARGUS_DELTA_SEARCH`.
- Normalize nullable API results.
- Render result cards with pagination.
- Test health/unauth/error/empty/result fixtures.

### Milestone 4: News, ABN, Federal Court providers

- Port News, ABN, Federal Court background functions from old extension.
- Add provider tabs/cards.
- Add exact/fuzzy behavior per provider.
- Keep Argus unquoted while using exact post-filter/ranking.

### Milestone 5: Caselaw page extraction

- Parse metadata and body entities on NSW Caselaw pages.
- Group entities:
  - current case parties
  - people
  - corporate entities
  - government entities
  - local councils
  - legal representatives
  - judges
- Add bulk research overview.
- Stage GLiNER/local model integration only after deterministic extraction is stable.

### Milestone 6: Documents workflow

- Port local PDF generation from old background code.
- Copy PDF templates and vendor libs.
- Build Documents tab UI.
- Pre-fill from court-list or caselaw metadata.
- Generate/save PDFs.
- Add Gmail draft/attachment automation only after local generation is stable.

### Milestone 7: Polish + docs + smoke tests

- Complete README/docs.
- Add Playwright visual smoke if practical.
- Add fixture-based harness tests.
- Package instructions.

## Risks and guardrails

- **Do not hardcode secrets.** Token was given in chat but must not enter source.
- **Do not delete old extensions.** The user is keeping original GLiNER and old Court Plus for now.
- **Argus Delta exact search cannot use quotes.** Strip quotes for API call.
- **Argus Delta result fields are nullable.** UI must not depend on court/date/location.
- **Chrome extension code is inspectable.** Prefer proxy or storage settings for tokens.
- **Caselaw ML extraction can become a rabbit hole.** Ship deterministic extraction first, then make GLiNER modular.
- **PDF determinism matters.** If porting document generation, preserve old rules: initialize checkbox fields off, apply only selected options, bake visual X overlays, flatten outputs.

## Recent conversation summary

- User first asked how GLiNER could benefit from NSW Courts+ as name searching was added.
- Analysis found old Courts+ has reusable party parsing, News, ABN, Federal Court, and PDF generation.
- User then asked to integrate Argus Delta search.
- Public Argus site was probed; later user supplied `/Users/perry/Documents/api-reference.md`.
- API was tested successfully against `https://be-api.argusdelta.com`.
- User then pivoted: build **Argus Delta Courtlens** in `v2`, supporting both court-list and caselaw sites, replacing old Court Plus only if successful.

## First command sequence for next agent

```bash
# Read required Graphify report first
python3 - <<'PY'
from pathlib import Path
p=Path('/Users/perry/Documents/Graphify/graphify-out/GRAPH_REPORT.md')
print(p.read_text()[:4000])
PY

# Use Graphify before broad search
cd /Users/perry/Documents/Graphify
graphify query "AD Chrome Extension NSW courtlist caselaw document application court file number venue ABN news Argus Delta Federal Court sidebar" --graph graphify-out/graph.json --budget 7000

# Inspect new project root
cd '/Users/perry/Local Projects/AD Chrome Extension/v2'
ls -la

# Inspect old docs and reusable files
cd '/Users/perry/Local Projects/AD Chrome Extension'
# use read tool where available; otherwise inspect README.md, PROJECT_INVENTORY.md, AGENTS.md, extension/manifest.json
```

## Recommended next response to user

Tell the user you have the handoff, then propose Milestone 1 scaffold and ask for approval on one key design choice:

> Should v2 use vanilla JS with shadcn-like CSS for fast MV3 reliability, or a Vite/React build for closer shadcn component fidelity?

Recommendation: vanilla JS + shadcn-like CSS first, because the existing extension is plain MV3 and the risk is lower.
