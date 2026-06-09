# Smoke Testing

Run the full local gate:

```bash
npm run verify
```

This runs:

1. `npm test`
2. `npm run build`
3. `npm run smoke`

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
- Python Playwright browser fixture smoke loads built `courtlist.js` and `caselaw.js` into mocked pages, confirms the sidebar mounts in a Shadow DOM, verifies the document-generation UI renders generated attachments, and exercises the Gmail draft handoff callback.
- Python Playwright unpacked-extension smoke loads `dist/` as a real Chrome extension, routes NSW target URLs to local fixtures, confirms manifest content scripts execute, and exercises real background PDF generation against bundled templates.

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

With `ARGUS_DELTA_TOKEN`, it additionally verifies:

- authenticated search returns `200` without printing the token.
- short-query validation returns `400`.

## Manual Chrome smoke

After `npm run verify`:

1. Load unpacked `dist/` in `chrome://extensions`.
2. Visit a NSW court-list page and confirm row buttons appear.
3. Click `Courtlens` and confirm the sidebar opens with Overview data.
4. Visit a NSW Caselaw decision page and confirm the floating launcher appears.
5. Open Settings and save an Argus Delta token locally.
6. Run an Argus Delta search for a query of at least two characters.
7. Confirm empty/error/result states render without exposing the token.
