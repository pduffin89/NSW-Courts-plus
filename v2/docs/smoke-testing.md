# Smoke Testing

Run the full local gate:

```bash
npm run verify
```

This runs:

1. `npm test`
2. `npm run build`
3. `npm run smoke`

For final release evidence and packaging, run the delivery audit through either final gate command:

```bash
npm run package:extension
# or
npm run audit:delivery
```

These commands run unit tests, `npm audit --audit-level=moderate`, the production build, MV3 extension policy audit, browser/extension smoke, live provider smoke, packaging from the verified `dist/` output, deterministic-package verification, extracted-release Chrome extension smoke, and release secret-leak audit. They write `artifacts/delivery-audit.json` with a prompt-to-artifact checklist, command statuses, an explicit `featureMatrix` mapping every named Courtlens deliverable to concrete files/routes/tests/smoke gates, exact dependency-spec checks, package metadata, release-archive contents, SHA-256 provenance for the zip and each packaged file, git metadata, and any external/manual gates that still need an operator or private credential. `npm run package:extension` then runs `npm run audit:release-readiness`, which cross-checks the current git HEAD, audit JSON, release ZIP SHA-256, release manifest policy, and expected external/manual gates before upload, writes `artifacts/release-readiness.json`, and writes `artifacts/SHA256SUMS` for the release ZIP plus evidence JSON files. Release packaging is deterministic, uses fixed ZIP timestamps and sorted entries, and excludes source maps / macOS metadata from the zip while leaving `dist/` useful for local debugging. After CI completes, `npm run verify:ci-artifact-parity -- --run-id <run-id>` downloads the CI `argus-delta-courtlens` artifact, verifies its `SHA256SUMS`, checks audit/readiness provenance against the CI run head, and compares the local release ZIP to CI byte-for-byte.

## Extension policy and secret audits

```bash
npm run build
npm run audit:policy
node scripts/package_extension.mjs
npm run audit:secrets
npm run audit:release-readiness
```

`scripts/extension_policy_audit.mjs` verifies MV3 manifest structure, exact permissions/host permissions, scoped content-script matches, no broad URL grants like `<all_urls>`, no insecure HTTP grants except loopback local NER, and no remote-code/eval patterns in built JavaScript bundles, including remote script tags, remote `importScripts`, remote dynamic imports, remote workers, and WebAssembly compile/instantiate calls.

`scripts/secret_audit.mjs` scans first-party source/docs/tests/scripts, package metadata, the Courtlens CI workflow, built text artifacts, and the release zip for private-key blocks, JWT literals, common API token prefixes, hardcoded bearer tokens, hardcoded `argusDeltaToken`/`abnGuid` values, and secret-like files accidentally included in the release archive.

## What smoke verifies

`scripts/smoke.mjs` checks:

- `dist/manifest.json` exists and names Argus Delta Courtlens.
- background/content bundles exist.
- PDF templates and vendor libraries are present in `dist/`.
- required documentation files exist.
- host permissions include Argus Delta and NSW Caselaw.
- content script matches include NSW Caselaw decision pages.
- background bundle does not contain obvious hardcoded token strings.
- court-list bundle contains the Courtlens launcher text.
- Python Playwright browser fixture smoke loads built `courtlist.js` and `caselaw.js` into mocked pages, confirms the sidebar mounts in a Shadow DOM, verifies local NER entity enhancement, verifies the document-generation UI renders generated attachments, and exercises the Gmail draft handoff callback.
- Python Playwright unpacked-extension smoke loads `dist/` as a real Chrome extension, routes NSW target URLs to local fixtures, confirms manifest content scripts execute, verifies Settings save/mask/persist behavior through `chrome.storage.local`, verifies routed Argus Delta, News, Federal Court, NSW Caselaw, ABN search, and ABN history workflows through the real MV3 background, verifies caselaw body entities render, exercises loopback local NER enhancement through `COURTLENS_EXTRACT_ENTITIES`, exercises real background PDF generation against bundled templates, and verifies the Gmail compose handoff opens a real Chrome tab with the expected encoded court-recipient payload.

## Browser fixture smoke

```bash
npm run build
python3 scripts/browser_smoke.py
python3 scripts/extension_load_smoke.py
node scripts/package_extension.mjs
npm run smoke:release-extension
```

Fixtures live in `fixtures/`. `browser_smoke.py` serves files through a local ephemeral HTTP server. `extension_load_smoke.py` launches Chromium with `--load-extension=dist` by default and uses Playwright route fulfillment for NSW URLs plus deterministic provider fixtures for Argus Delta, News, Federal Court, NSW Caselaw, ABN search, ABN history, and loopback local NER. It also saves Settings through the real sidebar UI, verifies secret masking, reads `chrome.storage.local` through the extension service worker, ensures the smoke token is not visible in sidebar text, verifies the local NER endpoint is persisted and used by the real background route, and verifies Gmail compose handoff via the real `chrome.tabs.create` path while accepting the normal unauthenticated Google sign-in redirect if the compose URL is preserved. `smoke:release-extension` extracts `artifacts/argus-delta-courtlens.zip`, loads the extracted payload as a real MV3 extension, and reruns the same routed NSW court-list/caselaw/provider/settings/Gmail workflow smoke against the artifact that is actually shipped.

## Live provider smoke

```bash
npm run smoke:live
ARGUS_DELTA_TOKEN='...' npm run smoke:live
ABN_GUID='...' npm run smoke:live
```

Without private credentials, live smoke verifies:

- `GET /health` returns `200` and `ok=true`.
- unauthenticated court-list search returns `401` and `ok=false`.
- Google News RSS returns RSS content.
- NSW Caselaw search returns HTML content.
- Federal Court search endpoint is reachable; this environment currently returns `403`, which is accepted and reported because the remote service blocks some automated clients.
- ABN Lookup current details page for a stable public ATO ABN returns expected entity markers.
- ABN Lookup history details page for the same public ABN returns expected entity markers.

With `ABN_GUID` or `COURTLENS_ABN_GUID`, it additionally verifies:

- ABN Lookup name-search JSONP returns the stable public ATO record.

The GitHub Actions workflow passes optional repository secrets named `ARGUS_DELTA_TOKEN`, `ABN_GUID`, and `COURTLENS_ABN_GUID` into both the full delivery audit job and the standalone live-smoke job. If the secrets are absent, the corresponding live branches skip with explicit evidence in `artifacts/delivery-audit.json`. The workflow also supports `workflow_dispatch`, so credentialed provider smoke can be rerun manually after adding or rotating secrets without requiring another source change.

With `ARGUS_DELTA_TOKEN`, it additionally verifies:

- authenticated search returns `200` without printing the token.
- short-query validation returns `400`.

## Live public extension smoke

```bash
npm run smoke:live-extension
CASELAW_LIVE_URL='https://www.caselaw.nsw.gov.au/search?query=Smith&page=1' \
ONLINEREGISTRY_LIVE_URL='https://onlineregistry.lawlink.nsw.gov.au/content/court-lists' \
npm run smoke:live-extension
```

This loads `dist/` as a real unpacked MV3 extension against live public NSW Caselaw and NSW Online Registry pages. It verifies the Caselaw floating launcher, verifies live Online Registry `Courtlens` row buttons, opens both Shadow DOM sidebars, and confirms the Online Registry Documents tab can generate the bundled PDF attachments from a live row. It is non-interactive and runs inside the delivery audit/CI under Xvfb.

Authenticated or targeted Online Registry workflows remain available through the operator smoke when a human browser session is needed.

## Operator-assisted live Chrome smoke

After `npm run verify`, run the headed operator smoke:

```bash
npm run smoke:operator
```

The script loads the real unpacked `dist/` extension in Chromium, opens the live NSW Online Registry and NSW Caselaw URLs, pauses for any human login/navigation, then verifies actual DOM injection and sidebar behavior.

Useful variants:

```bash
npm run smoke:operator -- --profile-dir artifacts/operator-chrome-profile
npm run smoke:operator -- --courtlist-url 'https://onlineregistry.lawlink.nsw.gov.au/content/court-lists' --caselaw-url 'https://www.caselaw.nsw.gov.au/decision/...'
npm run smoke:operator -- --skip-documents
ARGUS_DELTA_TOKEN='...' npm run smoke:operator
```

The operator smoke checks:

1. `dist/` loads as an unpacked MV3 extension.
2. A live NSW court-list page gets `[data-courtlens-open]` row buttons after the operator reaches a matter list.
3. Clicking `Courtlens` opens the Shadow DOM sidebar with Overview, Research, and Documents tabs.
4. Unless `--skip-documents` is used, the Documents tab generates the bundled PDF attachments.
5. A live NSW Caselaw page gets the floating `[data-courtlens-caselaw-launcher]` button.
6. Clicking the Caselaw launcher opens the sidebar with Overview, Research, and Settings tabs.
7. If `ARGUS_DELTA_TOKEN` is set, the script verifies the token value is not visible in checked page/sidebar text.

Manual-only fallback checklist, if Playwright cannot drive the operator browser:

1. Load unpacked `dist/` in `chrome://extensions`.
2. Visit a NSW court-list page and confirm row buttons appear.
3. Click `Courtlens` and confirm the sidebar opens with Overview data.
4. Visit a NSW Caselaw decision/search page and confirm the floating launcher appears.
5. Open Settings and save an Argus Delta token locally.
6. Run an Argus Delta search for a query of at least two characters.
7. Confirm empty/error/result states render without exposing the token.
