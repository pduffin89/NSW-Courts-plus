# Argus Delta Courtlens

Argus Delta Courtlens is a Manifest V3 Chrome extension for NSW court-list and NSW Caselaw workflows. It injects a right-side React sidebar that parses matter metadata, extracts legal entities, searches useful providers, and prepares document application payloads.

## Supported sites

- NSW Online Registry court lists: `https://onlineregistry.lawlink.nsw.gov.au/content/court-lists*`
- NSW Caselaw decisions/search: `https://www.caselaw.nsw.gov.au/decision/*`, `https://www.caselaw.nsw.gov.au/search*`

## Features

- Vite/React/TypeScript MV3 build.
- Shadow DOM sidebar with Overview, Research, Documents, and Settings tabs.
- Court-list row parsing for case number, title, court, jurisdiction, listing type, date, venue, and parties.
- NSW Caselaw metadata extraction for title, court, file number, decision date, judges, and citations.
- Deterministic judgment entity extraction for people, companies, councils, government bodies, and judges, rendered in the sidebar overview.
- Optional local NER/GLiNER-compatible enhancement endpoint for long judgment text.
- Provider router for Argus Delta, Google News, ABN seam, Federal Court, and NSW Caselaw.
- Argus Delta quote stripping, minimum query validation, bearer-token settings seam, nullable-result normalization, pagination metadata.
- Document application payload generation with court-recipient routing.
- Background PDF generation route using bundled templates and `pdf-lib`, returning base64 PDF attachments.
- Gmail compose handoff from the Documents tab using encoded court-recipient email payloads.

## Install for local development

```bash
cd '/Users/perry/Local Projects/AD Chrome Extension/v2'
npm install
npm run verify
```

Then load the extension:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select `dist/`.

## Settings and secrets

Open the Courtlens sidebar and use the Settings tab/workflow to store private values in `chrome.storage.local`:

- `argusDeltaToken`
- `argusDeltaProxyUrl`
- `abnGuid`
- applicant profile fields: name, organisation, email

Never hardcode tokens or GUIDs. The build and smoke tests include a basic hardcoded-secret guard for the background bundle.

## Common commands

```bash
npm test        # Vitest parser/provider/sidebar/content tests
npm run build   # TypeScript + Vite production build
npm run smoke       # Manifest, bundle, asset, docs, browser, extension-load, and secret checks
npm run smoke:live  # Safe live Argus health/unauth checks; authenticated checks if ARGUS_DELTA_TOKEN is set
npm run verify             # Full local verification gate
npm run package:extension  # Verify, then create artifacts/argus-delta-courtlens.zip
```

## Project layout

```text
extension/
  manifest.json
  public/              # copied to dist: manifest, PDF forms, vendor libs
  src/
    background/        # MV3 service worker and message handler
    content/           # court-list and caselaw content scripts
    core/              # typed contracts, text helpers, search router
    documents/         # document application payload + recipient routing
    parsers/           # court-list, party, caselaw, judgment entity parsers
    providers/         # Argus Delta, News, HTML search providers
    sidebar/           # React sidebar
    styles/            # shadcn-like Courtlens CSS
```

## Verification status

The project is designed so `npm run verify` is the release gate. Do not claim a milestone is complete unless that command passes and the prompt-to-artifact checklist is satisfied.
