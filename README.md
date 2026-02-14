# NSW Courts+

NSW Courts+ is a Chrome extension + local FastAPI service that helps court reporters move from list entry to publish-ready research and filing outputs in minutes.

## What It Does

- Injects action buttons into NSW Online Registry court list rows.
- Generates NSW court application PDFs from detected matter details.
- Opens Gmail compose and auto-attaches generated PDFs via extension worker retries.
- Adds a `Research` side panel with:
  - Google News tab for party-name news sweeps.
  - ABN tab for entity lookup with expandable current and historical ABN detail snapshots.
  - Caselaw tab for case search results (AustLII first, NSW Caselaw fallback) on the same party name, rendered as compact collapsible tiles with excerpts in expanded view.
- Stores generated files in easy-to-find local folders.

## Key Workflows

1. Open NSW court list page.
2. Click `Request Docs` for a matter.
3. Select requested docs and generate forms.
4. Gmail compose opens with attachments.
5. Click `Research` to run News + ABN + Caselaw checks on the same party name.
6. Use the `Exact` toggle in the Research panel to wrap the selected party name in quotes (for example `"Nick Shortt"`) across News, ABN, and Caselaw.
7. In `Caselaw`, use `Load more` to paginate additional result pages.
8. For multi-party matters, research auto-starts on the first detected party; click another party chip to switch.

## Architecture

- `extension/` (Manifest V3): content UI, background service worker, Gmail attach injector, research panel logic.
- `service/` (FastAPI): matter payload handling, PDF form filling, attachment URL generation, email draft metadata.
- `installer/` + `scripts/build_installer.py`: package installer assets and extension/service runtime scripts.

## Output Paths

- macOS generated files:
  - `~/Documents/Court Application Forms/Generated`
  - `~/Applications/NSW Court Autofill/data/Generated`

## Local Development

1. Install service dependencies:

```bash
cd service
python3 -m pip install --user -r requirements.txt
```

2. Run service:

```bash
cd service
python3 -m uvicorn main:app --host 127.0.0.1 --port 8765 --reload
```

3. Load extension:

- Open `chrome://extensions`
- Enable `Developer mode`
- `Load unpacked` -> `extension/`

4. Open NSW court lists:

- [https://onlineregistry.lawlink.nsw.gov.au/content/court-lists](https://onlineregistry.lawlink.nsw.gov.au/content/court-lists)

## Packaging

```bash
python3 scripts/build_installer.py
```

Produces:

- `dist/NSW-Court-Autofill-Installer.zip`

## Notes

- Local service target is `http://127.0.0.1:8765`.
- ABN lookup integration uses ABR web service + ABR details/history pages for expanded view data.
- Caselaw lookup tries AustLII search URLs (including `excerpt=1`) and falls back to NSW Caselaw when AustLII blocks automated fetches.
- Caselaw results are compact by default and show excerpt/catchwords when expanded.
- Extension version is bumped on every shipped UI/code change (mandatory project discipline).
