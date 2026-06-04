# NSW Courts+

NSW Courts+ is a Chrome extension that runs fully locally in Chrome to move court reporters from list entry to publish-ready research and filing outputs in minutes.

## What It Does

- Injects action buttons into NSW Online Registry court list rows.
- Generates NSW court application PDFs from detected matter details.
- Saves generated PDFs directly into Chrome Downloads under `Court Application Forms/Generated`.
- Opens Gmail compose and auto-attaches generated PDFs via extension worker retries.
- For Supreme Court media forms, mirrors Section C with a mode switch:
  - `Bail applications`: Crown bundle, submissions by applicant, selected images (+ image details field).
  - `Civil/Criminal (excl. bail)`: Originating process, transcript, exhibits, notice of appeal, other.
  - Auto-selects `Bail applications` when listing type is `Bail Hearing` or `Callover (Bail)`.
  - Supreme popup removes media/non-party form-type checkboxes (media form section only).
- For Local/District non-party forms, uses a `Crime` / `Civil` dropdown (auto-selected from list jurisdiction) and only shows template-matching checkboxes for the chosen mode.
- For criminal non-party matters, case title now prefers full defendant names in `R v <Full Name>` format with adaptive font sizing to reduce clipping in the case-title box.
- Signature fields are auto-generated as `FirstInitial.LastName` and rendered as handwritten overlays (`P.Duffin` style) across Supreme and non-party forms.
- Flattens generated PDFs before save so current values are baked into the file (prevents disappearing text/checkbox state drift in some viewers).
- Enforces deterministic checkbox behavior by resetting all checkbox fields to off, then applying only selected options (no template-default or court-mode checkbox carryover).
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
   - For Supreme Court, use Section C mode (`Bail applications` or `Civil/Criminal (excl. bail)`); bail-related listing types preselect bail mode.
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

## PDF Verification

Run the PDF matrix before shipping changes that affect form fields, court routing, document selections, signatures, or dates:

```bash
node --check extension/background.js
node --check extension/content.js
node --check extension/matter_parser.js
node scripts/validate_matter_parser.js
python3 scripts/validate_news_party_parser.py
python3 scripts/verify_pdf_matrix.py
python3 scripts/validate_extension_pdf_generation.py
node scripts/check_loaded_extension_version.js
python3 scripts/build_installer.py
```

`scripts/verify_pdf_matrix.py` generates representative Supreme bail, Supreme general, Local/District/Children/Coroner crime, Local civil, and District civil PDFs under `.tmp/pdf-matrix/`, then exhaustively tests every requested-document subset for those modes. It checks expected text, stale template text absence, visual tick overlays at the exact source checkbox rectangles, no visual ticks at unchecked checkbox rectangles, zero live form fields, and zero annotations.

`scripts/validate_extension_pdf_generation.py` runs the real Manifest V3 background-worker PDF code in a Node harness, applies the same 336-case field/text/date/signature/checkbox matrix to extension-generated PDFs, and also verifies routed `/generate` default-document behavior.

`scripts/check_loaded_extension_version.js` checks Chrome profile metadata for loaded unpacked NSW Courts+ copies and verifies both the on-disk manifest version and Chrome's stored service-worker version match `extension/manifest.json`. If the disk version matches but the stored worker is old, reload the unpacked extension in `chrome://extensions`.

## Notes

- Generation is fully local inside the extension worker (no background service required).
- PDF checkbox/text determinism (finalized):
  - Root cause 1 (fixed): Local Criminal doc coercion in service generation dropped selected docs (for example `police_fact_sheet`).
  - Root cause 2 (fixed): checkbox fields not explicitly initialized to off allowed template defaults to leak into output.
  - Permanent pattern:
    - never coerce selected docs by court/jurisdiction
    - initialize all checkbox fields to off
    - apply only selected fields to on
    - overlay visual `X` for checked boxes
    - flatten and strip form interactivity before save
  - District Court Civil uses a manual visual tick overlay because the source non-party PDF prints a District Court Civil checkbox but exposes no AcroForm widget for that checkbox.
  - Reference skill: `skills/nsw-court-pdf-determinism/SKILL.md`
- ABN lookup integration uses ABR web service + ABR details/history pages for expanded view data.
- Caselaw lookup tries AustLII search URLs (including `excerpt=1`) and falls back to NSW Caselaw when AustLII blocks automated fetches.
- Caselaw results are compact by default and show excerpt/catchwords when expanded.
- Federal Court lookup uses the Federal Court Digital Law Library search endpoint (`search.judgments.fedcourt.gov.au`) with full-text query (`query_sand`) and `start_rank` pagination.
- Court-list action rail inherits row stripe background so alternating row colours continue beneath `Request Docs` and `Research` buttons.
- Extension version is bumped on every shipped UI/code change (mandatory project discipline).
