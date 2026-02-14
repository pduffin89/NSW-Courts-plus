# NSW Court Autofill Agent Notes

## Success State

- Draft email opens in Gmail with generated PDF attachments present.
- Generated PDFs are easy to find in:
  - macOS: `/Users/<user>/Documents/Court Application Forms/Generated`
  - Windows equivalent target: `C:\\Users\\<user>\\Documents\\Court Application Forms\\Generated`
- Local service remains stable at `http://127.0.0.1:8765`.

## Working Architecture (Current)

1. Extension content script gathers matter + profile + selected documents.
2. Backend `/generate` creates PDF(s), returns attachment URLs and Gmail compose URL.
3. Background worker opens Gmail compose tab and stores a pending attach job in `chrome.storage.local`.
4. Background worker fetches attachment bytes from backend tokenized URLs.
5. Background worker runs `chrome.scripting.executeScript` in Gmail tab to attach files.
6. Retry loop (`chrome.alarms`) continues until success or max attempts.

Key implementation file:
- `extension/background.js`

## Why This Works Better

- No dependency on Gmail content-script receiver handshakes.
- Attach execution is direct from background worker via injected function.
- Compose-root detection supports multiple Gmail layouts:
  - popup dialog compose
  - full-page compose
  - form/subject/to-field fallback

## Verified Reliability Evidence

- Input-file attach harness: multiple repeated passes successful.
- Drag/drop fallback harness: multiple repeated passes successful.
- Full-page compose harness (no dialog): repeated passes successful.
- To/subject form-style compose harness: repeated passes successful.
- Backend attachment fetch loop from real `/generate` output URLs: repeated `HTTP 200` and non-zero bytes.

## Regression Checklist (Required Before Claiming Fix)

1. Run JS syntax checks:
   - `node --check extension/background.js`
   - `node --check extension/content.js`
2. Run repeated backend attachment URL checks (at least 3 passes).
3. Run repeated browser-side attach harness checks for:
   - input-file path
   - drag/drop fallback path
   - at least one non-dialog compose layout
4. Rebuild installer:
   - `python3 scripts/build_installer.py`
5. Confirm installed extension manifest version matches source and reload extension.

## Version Discipline (Mandatory)

- Every extension code or UI change MUST bump `extension/manifest.json` version (patch increment at minimum).
- Every release sync MUST copy updated extension files to installed path:
  - `/Users/perry/Applications/NSW Court Autofill/extension`
- Never claim fix shipped until Chrome shows the new version in `chrome://extensions`.

## Operational Debug Guide

If attach still fails, inspect extension service worker logs in `chrome://extensions`:

- `Attach retry scheduled ... reason: Compose window not found.`
  - Compose DOM detection missed active compose layout.
- `Attach retry scheduled ... reason: Attachment upload not detected in Gmail UI.`
  - Injection ran, but Gmail did not register upload indicators.
- `Attach succeeded ...`
  - Expected terminal state.

When debugging, always capture:

1. Extension version shown in Chrome.
2. Exact retry reason from service worker logs.
3. Whether generated PDF exists in Documents `Generated` folder.
