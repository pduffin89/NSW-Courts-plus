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

## Manual Chrome smoke

After `npm run verify`:

1. Load unpacked `dist/` in `chrome://extensions`.
2. Visit a NSW court-list page and confirm row buttons appear.
3. Click `Courtlens` and confirm the sidebar opens with Overview data.
4. Visit a NSW Caselaw decision page and confirm the floating launcher appears.
5. Open Settings and save an Argus Delta token locally.
6. Run an Argus Delta search for a query of at least two characters.
7. Confirm empty/error/result states render without exposing the token.
