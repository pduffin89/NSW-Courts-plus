# Chrome Web Store listing draft

This document is the store-submission handoff for Argus Delta Courtlens. Keep it aligned with `docs/privacy-security.md`, `docs/release-readiness.md`, and the release ZIP produced by `npm run package:extension`.

## Listing basics

- **Name:** Argus Delta Courtlens
- **Short description:** Research NSW court-list and caselaw matters from a private Chrome sidebar.
- **Category:** Productivity
- **Language:** English (Australia)
- **Release artifact:** `artifacts/argus-delta-courtlens.zip`
- **Evidence artifacts:** `artifacts/delivery-audit.json`, `artifacts/release-readiness.json`, `artifacts/SHA256SUMS`

## Long description

Argus Delta Courtlens adds a private research sidebar to supported NSW legal research pages. It helps legal and investigation teams parse NSW Online Registry court-list rows and NSW Caselaw pages, identify parties and entities, search configured research providers, generate local document-application PDFs from bundled templates, and open a prefilled Gmail compose draft.

Supported sites:

- NSW Online Registry court lists
- NSW Caselaw decisions and search pages

Key features:

- React/TypeScript Manifest V3 extension with a Shadow DOM sidebar.
- Court-list parsing for matter titles, court, venue, listing date, parties, and case identifiers.
- NSW Caselaw parsing for judgment metadata and entity candidates.
- Research buttons for Argus Delta, Google News, ABN Lookup, Federal Court, and NSW Caselaw.
- ABN current and history detail expansion.
- Optional loopback-only local NER enhancement for users running their own local compatible service.
- Local PDF generation from bundled application templates.
- Gmail compose handoff using a prefilled URL; Courtlens does not read Gmail inbox or message content.
- Settings stored locally in Chrome storage; private tokens and GUIDs are user-provided.

## Permission justification

| Permission / host | Justification |
|---|---|
| `storage` | Stores user settings locally, including provider token/GUID values and applicant profile fields. |
| `https://www.caselaw.nsw.gov.au/*` | Injects the sidebar on NSW Caselaw and fetches public Caselaw search/detail pages. |
| `https://news.google.com/*` | Fetches Google News RSS search results. |
| `https://abr.business.gov.au/*` | Fetches ABN Lookup search/current/history pages. |
| `https://search.judgments.fedcourt.gov.au/*` | Fetches Federal Court search pages. |
| `https://be-api.argusdelta.com/*` | Calls Argus Delta APIs when the user provides a token. |
| `http://127.0.0.1/*`, `http://localhost/*` | Optional local NER/GLiNER-compatible endpoint; non-loopback endpoints are rejected. |

No Gmail host permission is requested because Gmail is opened only as a compose URL handoff. No Online Registry host permission is requested because Online Registry access is via statically declared content-script matches only.

## Privacy disclosure draft

Courtlens processes court-list and caselaw page text in the browser to extract matter metadata and entity names. It stores user settings in Chrome local storage. It only sends search queries to selected providers when the user presses a research button. Argus Delta tokens and ABN GUIDs are user-entered settings and are not bundled in the extension.

Courtlens does not sell data, does not use data for advertising, does not collect browsing history outside the supported sites, and does not transmit Gmail content. Generated PDFs are created locally from bundled templates and user/page metadata.

## Single-purpose statement

Courtlens provides a research and document-preparation sidebar for NSW court-list and caselaw workflows.

## Remote code / MV3 policy statement

The extension does not execute remotely hosted code. Release packaging excludes source maps and macOS metadata. The release manifest uses Manifest V3, strict extension-page CSP, exact permissions, no optional permissions, no externally connectable surface, and no web-accessible resources.

## QA evidence before upload

Run and retain:

```bash
npm run package:extension
cd artifacts && shasum -a 256 -c SHA256SUMS
npm run verify:ci-artifact-parity -- --run-id <run-id>
```

Expected release ZIP SHA for the current deterministic build is recorded in `artifacts/delivery-audit.json`, `artifacts/release-readiness.json`, and `artifacts/SHA256SUMS`.

## Screenshot guidance

Capture screenshots from a clean browser profile with no real client secrets visible:

1. Sidebar Overview tab on a fixture or non-sensitive public NSW court-list row.
2. Research tab showing provider buttons and non-sensitive routed results.
3. Documents tab showing generated attachment chips, not private client data.
4. Settings tab with masked token/GUID fields only.

Do not include real Argus tokens, ABN GUIDs, client names, email addresses, or confidential court data in screenshots.

## Support / maintenance notes

- Keep `docs/privacy-security.md` and this listing in sync for permission/data-use statements.
- Re-run `npm run package:extension` and CI artifact parity after any manifest, provider, or packaging change.
- If credentialed live coverage is required, configure `ARGUS_DELTA_TOKEN` and either `ABN_GUID` or `COURTLENS_ABN_GUID` as GitHub repository secrets, then manually dispatch `Courtlens v2 CI`.
