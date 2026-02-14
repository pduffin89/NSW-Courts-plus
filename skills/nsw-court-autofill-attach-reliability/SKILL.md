---
name: nsw-court-autofill-attach-reliability
description: Stabilize and troubleshoot NSW Court Autofill Gmail attachment delivery. Use when draft emails open without PDF attachments, when extension logs show attach retries or compose detection failures, or when modifying attachment flow in extension/background.js and related manifest settings.
---

# NSW Court Autofill Attachment Reliability

Use this skill to keep attachment delivery reliable after Gmail, Chrome, or extension changes.

## Focus Files

- `extension/background.js`
- `extension/manifest.json`
- `extension/content.js`
- `service/autofill/orchestrator.py`

## Required Workflow

1. Confirm generation still works:
   - `/generate` returns `generated_files` and `attachment_urls`.
   - Generated file exists in Documents `Generated` path.
2. Debug attach layer separately from generation:
   - Treat missing attachment as extension/Gmail integration issue first.
3. Prefer direct attach execution from background via `chrome.scripting.executeScript`.
4. Keep retry state durable in `chrome.storage.local` with alarm-based retries.
5. Support multiple Gmail compose layouts (dialog and full-page variants).
6. Declare success only after repeated runs, not a single pass.

## Reliability Guardrails

- Do not depend solely on `chrome.tabs.sendMessage` receiver availability.
- Do not hardcode one compose DOM shape.
- Track attempts and clear pending jobs only on positive attach detection.
- Use explicit log reasons for every retry branch.

## Minimum Verification Standard

Run all checks before calling the fix complete:

1. Syntax:
   - `node --check extension/background.js`
   - `node --check extension/content.js`
2. Repeated backend token URL checks:
   - At least 3 successful download passes from returned `attachment_urls`.
3. Repeated browser-side attach harness checks:
   - Input-file attach path: repeated success
   - Drag/drop fallback path: repeated success
   - Non-dialog compose layout: repeated success
4. Packaging:
   - `python3 scripts/build_installer.py`
5. Install sync:
   - Confirm installed extension manifest version matches source after copy/reload.

## Failure Mapping

- `Compose window not found.`
  - Compose-root detection needs broader selectors/fallback.
- `Attachment upload not detected in Gmail UI.`
  - Upload action fired, but indicator detection missed; improve indicator selectors or wait window.
- `Could not fetch attachment files from local service.`
  - Backend token fetch issue or service unavailable.

## Output Expectations

When reporting results, always include:

1. Changed files.
2. Number of repeated verification passes per test path.
3. Installed extension version verified in target path.
