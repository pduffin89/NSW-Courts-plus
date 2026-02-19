# NSW Courts+

NSW Courts+ is a Chrome extension that runs fully locally in Chrome to move court reporters from list entry to publish-ready research and filing outputs in minutes.

## What It Does

- Injects action buttons into NSW Online Registry court list rows.
- Generates NSW court application PDFs from detected matter details.
- Saves generated PDFs directly into Chrome Downloads under `Court Application Forms/Generated`.
- Opens Gmail compose and auto-attaches generated PDFs via extension worker retries.
- For Supreme Court media forms, mirrors Section C with a mode switch:
  - `Bail applications`: Crown bundle, submissions by applicant, selected images (+ image details field).
  - `All others incl. civil/criminal/appellate`: Originating process, transcript, exhibits, notice of appeal, other.
- Adds a `Research` side panel with:
  - Google News tab for party-name news sweeps.
  - ABN tab for entity lookup with expandable current and historical ABN detail snapshots.
  - Caselaw tab for case search results (AustLII first, NSW Caselaw fallback) on the same party name, rendered as compact collapsible tiles with excerpts in expanded view.
  - Federal Court tab for full-text Digital Law Library search hits with expandable excerpts and pagination.
- Stores generated files in easy-to-find local folders.

## Key Workflows

1. Open NSW court list page.
2. Click `Request Docs` for a matter.
3. Select requested docs and generate forms.
   - For Supreme Court, choose the Section C mode (`Bail applications` or `All others...`) in the popup.
4. Gmail compose opens with attachments.
5. Click `Research` to run News + ABN + Caselaw + Federal Court checks on the same party name.
6. Use the `Exact` toggle in the Research panel to wrap the selected party name in quotes (for example `"Nick Shortt"`) across News, ABN, Caselaw, and Federal Court.
   - ABN exact mode applies phrase filtering to ABN entity names so exact mode materially narrows ABN matches.
7. In `Caselaw` and `Federal Court`, use `Load more` to paginate additional result pages.
8. For multi-party matters, research auto-starts on the first detected party; click another party chip to switch.

## Architecture

- `extension/` (Manifest V3): content UI, background service worker, Gmail attach injector, research panel logic.
- `installer/` + `scripts/build_installer.py`: package installer assets.

## Output Paths

- All platforms generated files:
  - Chrome Downloads: `Court Application Forms/Generated`

## Local Development

1. Load extension:

- Open `chrome://extensions`
- Enable `Developer mode`
- `Load unpacked` -> `extension/`

2. Open NSW court lists:

- [https://onlineregistry.lawlink.nsw.gov.au/content/court-lists](https://onlineregistry.lawlink.nsw.gov.au/content/court-lists)

## Packaging

```bash
python3 scripts/build_installer.py
```

Produces:

- `dist/NSW-Court-Autofill-Installer-Cross-Platform.zip`

Installer entry points in the zip:

- Auto-detect launcher: `install.py`
- macOS: `install.command`
- Windows (PowerShell): `install.ps1`

## Notes

- Generation is fully local inside the extension worker (no background service required).
- ABN lookup integration uses ABR web service + ABR details/history pages for expanded view data.
- Caselaw lookup tries AustLII search URLs (including `excerpt=1`) and falls back to NSW Caselaw when AustLII blocks automated fetches.
- Caselaw results are compact by default and show excerpt/catchwords when expanded.
- Federal Court lookup uses the Federal Court Digital Law Library search endpoint (`search.judgments.fedcourt.gov.au`) with full-text query (`query_sand`) and `start_rank` pagination.
- Court-list action rail inherits row stripe background so alternating row colours continue beneath `Request Docs` and `Research` buttons.
- Extension version is bumped on every shipped UI/code change (mandatory project discipline).
