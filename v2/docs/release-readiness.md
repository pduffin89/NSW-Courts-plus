# Chrome Web Store Release Readiness

This checklist is for the final human/operator release review before uploading `artifacts/argus-delta-courtlens.zip` to the Chrome Web Store.

## Release artifact

- Upload artifact: `artifacts/argus-delta-courtlens.zip`
- Evidence artifacts: `artifacts/delivery-audit.json`, `artifacts/release-readiness.json`, and `artifacts/SHA256SUMS`
- Final command: `npm run package:extension`
- Pre-upload verifier: `npm run audit:release-readiness`
- CI workflow: `Courtlens v2 CI`
- The release ZIP is deterministic, source-map-free, `.DS_Store`-free, and secret-audited.
- Before upload, confirm `delivery-audit.json.archive.sha256` matches the ZIP being uploaded.
- Verify checksums with `cd artifacts && shasum -a 256 -c SHA256SUMS`.

## Permission justification

Current extension API permissions:

| Permission | Why it is needed |
|---|---|
| `storage` | Stores user-entered settings locally: Argus Delta token, ABN GUID, local NER endpoint, and applicant profile fields. |

Current host permissions:

| Host | Why it is needed |
|---|---|
| `https://be-api.argusdelta.com/*` | User-triggered Argus Delta court-list provider searches from the sidebar. |
| `https://news.google.com/*` | User-triggered Google News RSS research searches. |
| `https://abr.business.gov.au/*` | User-triggered ABN name search plus ABN current/history detail expansion. |
| `https://search.judgments.fedcourt.gov.au/*` | User-triggered Federal Court judgment search. |
| `https://www.caselaw.nsw.gov.au/*` | User-triggered NSW Caselaw provider search from the background worker. |
| `http://127.0.0.1/*` | Optional loopback-only local NER / GLiNER-compatible endpoint. |
| `http://localhost/*` | Optional loopback-only local NER / GLiNER-compatible endpoint. |

Static content-script matches are deliberately narrower than broad host access:

| Site | Content-script scope |
|---|---|
| NSW Online Registry | `https://onlineregistry.lawlink.nsw.gov.au/content/court-lists*` |
| NSW Caselaw | `https://www.caselaw.nsw.gov.au/decision/*`, `https://www.caselaw.nsw.gov.au/search*` |

Notably absent:

- No `<all_urls>` grant.
- No `tabs` permission.
- No Gmail host permission; Gmail is opened by URL handoff only.
- No web-accessible resources; bundled PDFs/vendor assets stay private to extension contexts.
- No optional permissions, externally-connectable surface, OAuth client, manifest key, or custom update URL.
- Policy audit rejects remote-code vectors including remote script tags, remote `importScripts`, remote dynamic imports, remote workers, and WebAssembly compile/instantiate calls.

## Data use disclosure draft

Courtlens processes page metadata from NSW Online Registry court-list pages and NSW Caselaw pages when the user opens the sidebar. It can send user-triggered search queries to selected research providers: Argus Delta, Google News, ABN Lookup, Federal Court search, NSW Caselaw, and an optional loopback-only local NER service configured by the user.

Courtlens stores user settings in Chrome local extension storage, including optional Argus Delta token, optional ABN GUID, optional local NER endpoint, and applicant profile fields used to generate document application payloads. It does not sell data, does not run background analytics, does not inject remote code, and does not expose bundled assets as web-accessible resources.

## Privacy policy notes

Store listing copy, permission explanations, privacy disclosure draft, and screenshot guidance live in `docs/web-store-listing.md`.

A store-facing privacy policy should include:

- Data is processed locally except when the user triggers provider searches or Gmail compose handoff.
- Provider searches send the selected query text to the selected provider.
- Argus Delta tokens and ABN GUIDs are user-provided and stored in `chrome.storage.local`.
- Gmail handoff opens a prefilled compose URL; Courtlens does not read Gmail content or attach files inside Gmail.
- Generated PDFs are produced locally from bundled templates and page/applicant metadata.
- Optional local NER only permits loopback endpoints (`127.0.0.1` / `localhost`).

## Final upload checklist

1. Run `npm run package:extension` from `v2/`.
2. Confirm every automated gate in `artifacts/delivery-audit.json` is passing.
3. Confirm only expected external/manual gates remain:
   - optional authenticated Argus live search if `ARGUS_DELTA_TOKEN` was not provided;
   - optional authenticated ABN name-search live smoke if `ABN_GUID` / `COURTLENS_ABN_GUID` was not provided;
   - operator-assisted authenticated/targeted NSW workflow if a login-specific target was requested.
4. If credentialed provider coverage is required, configure GitHub repository secrets `ARGUS_DELTA_TOKEN` and either `ABN_GUID` or `COURTLENS_ABN_GUID`; the CI workflow passes them to both the full delivery audit and standalone live-smoke jobs.
5. After adding or rotating those secrets, rerun GitHub Actions `Courtlens v2 CI` manually via `workflow_dispatch` so the credentialed live-smoke branches run without requiring another source change.
6. Confirm latest GitHub Actions `Courtlens v2 CI` is green for the same `git.headSha`.
7. Run `npm run verify:ci-artifact-parity -- --run-id <run-id>` to verify the CI `argus-delta-courtlens` artifact checksums and confirm the local release ZIP matches CI byte-for-byte.
8. Confirm `docs/web-store-listing.md` is still accurate for permissions, host access, privacy disclosure, screenshots, and support notes.
9. Upload `artifacts/argus-delta-courtlens.zip`.
10. Keep `artifacts/delivery-audit.json`, `artifacts/release-readiness.json`, and `artifacts/SHA256SUMS` with the release record.
