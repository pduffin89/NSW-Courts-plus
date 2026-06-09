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
- `localNerEndpoint` for optional loopback-only local NER/GLiNER services (`http://127.0.0.1/...` or `http://localhost/...`)
- applicant profile fields: name, organisation, email

Never hardcode tokens or GUIDs. The build and smoke tests include a basic hardcoded-secret guard for the background bundle.

## Common commands

```bash
npm test        # Vitest parser/provider/sidebar/content tests
npm run build   # TypeScript + Vite production build
npm run audit:policy  # MV3 manifest, permissions, host scopes, and remote-code policy checks
npm run audit:secrets # Source, dist, and release archive secret-leak checks
npm run audit:package-determinism # Repeated package SHA-256 stability check
npm run audit:release-readiness # Pre-upload audit/ZIP/manifest/provenance cross-check
npm run audit:evidence-manifest # Verify SHA256SUMS and optional evidence provenance match current HEAD
npm run write:checksums # Write artifacts/SHA256SUMS for release evidence
npm run verify:ci-artifact-parity -- --run-id <run-id> # Compare local release artifacts to CI and write artifacts/ci-artifact-parity.json
npm run verify:live-smoke-artifact -- --run-id <run-id> # Verify standalone CI live-smoke artifact evidence
npm run smoke       # Manifest, bundle, asset, docs, browser, extension-load, and secret checks
npm run smoke:live           # Live provider checks; writes artifacts/live-smoke.json; credentialed branches run when secrets are set
npm run smoke:live-extension # Real unpacked extension on public NSW Caselaw + Online Registry
npm run smoke:release-extension # Extract and load the shipped zip as a real MV3 extension
npm run smoke:operator       # Headed operator-assisted smoke on live NSW pages; writes artifacts/operator-live-smoke.json on pass
npm run verify:operator-smoke-evidence # Verify headed operator smoke evidence for current HEAD
npm run capture:screenshots  # Generate non-sensitive release/store screenshot evidence
npm run verify             # Fast local verification gate
npm run package:extension  # Full delivery audit, release-clean zip, evidence JSON, checksums, and evidence-manifest audit
npm run audit:delivery     # Same final delivery gate used by package:extension
npm run audit:completion   # Goal-completion audit; fails until credentialed/manual gates are evidenced
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

Release upload checklist and Chrome Web Store disclosure notes live in `docs/release-readiness.md`; store listing copy, permission justifications, and screenshot guidance live in `docs/web-store-listing.md`; credentialed/manual gate evidence templates live in `docs/manual-verification.md`.

## Verification status

The project is designed so `npm run verify` is the fast local gate, while `npm run package:extension` is the final evidence and pre-upload gate. `npm run audit:delivery` writes `artifacts/delivery-audit.json`; `npm run audit:release-readiness` verifies that the current release ZIP, audit JSON, git HEAD, manifest policy, and known external/manual gates all agree. After CI completes, `npm run verify:ci-artifact-parity -- --run-id <run-id>` verifies the uploaded CI artifact checksums and compares the local release ZIP with CI byte-for-byte. `npm run audit:completion` writes `artifacts/completion-audit.json` and fails until private-credential and operator gates have concrete evidence from `artifacts/live-smoke.json`, `artifacts/standalone-live-smoke-artifact.json`, `artifacts/operator-live-smoke.json`, `artifacts/operator-smoke-verification.json`, or `artifacts/manual-verification.json`. After generating parity/completion evidence, run `npm run write:checksums && npm run audit:evidence-manifest` to verify `SHA256SUMS` matches current artifacts and HEAD provenance. Do not claim a milestone is complete unless the final gate passes and the prompt-to-artifact checklist is satisfied, including any manual or private-credential items recorded in `artifacts/delivery-audit.json`.
