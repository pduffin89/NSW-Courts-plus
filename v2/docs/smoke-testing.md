# Smoke Testing

Run the full local gate:

```bash
npm run verify
```

This runs:

1. `npm test`
2. `npm run build`
3. `npm run smoke`

For final release evidence, run the delivery audit:

```bash
npm run audit:delivery
```

This runs unit tests, the production build, browser/extension smoke, live provider smoke, and packaging from the verified `dist/` output. It writes `artifacts/delivery-audit.json` with a prompt-to-artifact checklist, command statuses, exact dependency-spec checks, package metadata, release-archive contents, SHA-256 provenance for the zip and each packaged file, git metadata, and any external/manual gates that still need an operator or private credential. Release packaging uses a temporary staging directory and excludes source maps / macOS metadata from the zip while leaving `dist/` useful for local debugging.

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
- Python Playwright unpacked-extension smoke loads `dist/` as a real Chrome extension, routes NSW target URLs to local fixtures, confirms manifest content scripts execute, verifies caselaw body entities render, and exercises real background PDF generation against bundled templates.

## Browser fixture smoke

```bash
npm run build
python3 scripts/browser_smoke.py
python3 scripts/extension_load_smoke.py
```

Fixtures live in `fixtures/`. `browser_smoke.py` serves files through a local ephemeral HTTP server. `extension_load_smoke.py` launches Chromium with `--load-extension=dist` and uses Playwright route fulfillment for NSW URLs.

## Live provider smoke

```bash
npm run smoke:live
ARGUS_DELTA_TOKEN='...' npm run smoke:live
```

Without a token, live smoke verifies:

- `GET /health` returns `200` and `ok=true`.
- unauthenticated court-list search returns `401` and `ok=false`.
- Google News RSS returns RSS content.
- NSW Caselaw search returns HTML content.
- Federal Court search endpoint is reachable; this environment currently returns `403`, which is accepted and reported because the remote service blocks some automated clients.

With `ARGUS_DELTA_TOKEN`, it additionally verifies:

- authenticated search returns `200` without printing the token.
- short-query validation returns `400`.

## Live public extension smoke

```bash
npm run smoke:live-extension
CASELAW_LIVE_URL='https://www.caselaw.nsw.gov.au/search?query=Smith&page=1' npm run smoke:live-extension
```

This loads `dist/` as a real unpacked MV3 extension against a live public NSW Caselaw page, verifies the floating launcher is injected by the manifest content script, clicks it, and confirms the Shadow DOM sidebar renders Overview, Research, Documents, and Settings. It is non-interactive and runs inside the delivery audit/CI under Xvfb.

NSW Online Registry live rows are intentionally left to the operator smoke because reaching a real matter list may require human login/navigation.

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
