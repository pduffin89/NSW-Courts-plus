# NSW Courts+ Project Inventory

Copied on: 2026-06-04

## Source

- Remote machine: `perrys-mac-mini` on Tailscale (`100.89.36.94`)
- Remote source folder: `/Users/perry/LocalProjects/NSW Courts Plus Chrome Extension`
- Local working copy: `/Users/perry/Local Projects/AD Chrome Extension`
- Git remote: `https://github.com/pduffin89/NSW-Courts-plus.git`
- Copied commit: `51397ba` (`2026-03-04 14:25:41 +1100`) - `Normalize AcroForm fields before extension flatten`
- Extension manifest version: `0.3.19`

I also found an older sibling copy at `/Users/perry/LocalProjects/NSW-Courts-plus`, last commit `1736f6e` from 2026-02-20. The copied folder is the newer and fuller working tree.

## Purpose

`NSW Courts+ Cross-Platform Autofill` is a Manifest V3 Chrome extension for NSW Online Registry court lists. It injects row actions into court-list pages so a reporter can request court documents, generate PDF application forms, open Gmail compose, attach the generated forms, and run research on matter parties from the same row.

## Main Features

- Injects `Request Docs` and `Research` actions into NSW Online Registry court-list rows.
- Generates NSW media access and non-party access PDF application forms locally in the extension worker.
- Saves generated PDFs under Chrome Downloads: `Court Application Forms/Generated`.
- Opens Gmail compose and attaches generated PDFs through a background retry pipeline.
- Provides a research drawer with:
  - Google News party-name searches.
  - ABN lookup and expandable current/history details.
  - NSW/AustLII caselaw search with expandable result cards and pagination.
  - Federal Court Digital Law Library search with expandable excerpts and pagination.
- Supports exact phrase mode for research queries.
- Includes PDF determinism fixes for checkbox state, field flattening, signature overlays, and form appearance stability.

## Key Files

- `extension/manifest.json` - Chrome extension metadata, permissions, and content-script targets.
- `extension/content.js` - NSW court-list UI injection, party extraction flow, request dialog, and research drawer rendering.
- `extension/background.js` - PDF generation, downloads, Gmail attach pipeline, and remote research fetch providers.
- `extension/gmail_content.js` - Gmail attachment helper code.
- `extension/party_parser.js` - party/matter parsing utilities used by the content script and validator.
- `extension/content.css` - injected UI and research drawer styles.
- `extension/forms/` - bundled source PDF templates.
- `extension/vendor/` - bundled `pdf-lib`, `fontkit`, and handwriting font assets.
- `scripts/build_installer.py` - cross-platform installer package builder.
- `scripts/validate_news_party_parser.py` - parser regression checks.
- `installer/` - macOS/Windows/local installer entry points.
- `service/` - older/local-service generation implementation retained for reference and parity.
- `skills/nsw-court-autofill-attach-reliability/SKILL.md` - project-specific Gmail attachment reliability protocol.
- `skills/nsw-court-pdf-determinism/SKILL.md` - project-specific PDF determinism protocol.

## Development Workflow

1. Load the extension from `/Users/perry/Local Projects/AD Chrome Extension/extension` in `chrome://extensions`.
2. Enable Developer mode.
3. Open `https://onlineregistry.lawlink.nsw.gov.au/content/court-lists`.
4. Use `Request Docs` to generate PDFs and Gmail drafts.
5. Use `Research` to run party-name checks across News, ABN, Caselaw, and Federal Court.

Before calling a code/UI change complete:

```bash
node --check extension/background.js
node --check extension/content.js
python3 scripts/validate_news_party_parser.py
python3 scripts/build_installer.py
```

Project discipline from `AGENTS.md`:

- Bump `extension/manifest.json` version for every extension code or UI change.
- Rebuild the installer after release changes.
- Keep README/current docs aligned with behavior.
- Commit and push completed work to `main` after verification.

## Verification Performed After Copy

```bash
node --check extension/background.js
node --check extension/content.js
python3 scripts/validate_news_party_parser.py
python3 scripts/build_installer.py
```

Result:

- JavaScript syntax checks passed.
- Parser validation passed: `PASS (20 cases)`.
- Installer rebuilt at `dist/NSW-Court-Autofill-Installer-Cross-Platform.zip`.
