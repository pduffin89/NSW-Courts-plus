---
name: nsw-court-pdf-determinism
description: Generate NSW court PDFs with deterministic checkbox/text output across viewers. Use when debugging wrong ticks, missing ticks, disappearing text, stale values, or flattening inconsistencies.
---

# NSW Court PDF Determinism

Use this skill when PDF output appears inconsistent between runs or viewers, especially for non-party form checkbox states.

## Root Causes (Historical)

1. Requested-doc coercion bug:
   - Local Court Criminal flow previously replaced selected docs with `indictment_can` only.
   - Result: user-selected options like `police_fact_sheet` were silently dropped.

2. Template-default checkbox leakage:
   - If unchecked checkbox fields are not explicitly set to Off, template defaults can reappear.

3. Viewer-dependent appearance behavior:
   - Interactive fields can render differently or disappear if not flattened and appearance-safe.

## Permanent Rules

1. Never coerce requested documents by court/jurisdiction.
2. Always initialize every checkbox field to Off first.
3. Then apply only explicitly selected fields to On.
4. Burn checked states visually (`X` overlays) before stripping form interactivity.
5. Flatten and strip form layers (`/Annots`, `/AcroForm/Fields`) before output.

## Focus Files

- `service/autofill/orchestrator.py`
- `service/autofill/pdf_forms.py`
- `extension/background.js`
- `extension/manifest.json`

## Required Verification

1. Syntax:
   - `node --check extension/background.js`
   - `node --check extension/content.js`

2. Deterministic generation check (same matter, two payloads):
   - Payload A includes `police_fact_sheet`.
   - Payload B excludes `police_fact_sheet`.
   - Confirm exactly one additional rendered `X` in A vs B for the target form.

3. Flattening check:
   - `get_fields()` returns no fields.
   - `/Annots` count is zero.

4. Audit check:
   - Last `audit-log.jsonl` entry `requested_documents` matches submitted payload.

5. Release discipline:
   - Rebuild installer: `python3 scripts/build_installer.py`
   - Sync installed extension files.
   - Confirm installed manifest version matches source.

## Failure Mapping

- Wrong tick missing in Local Court Criminal:
  - Inspect requested-doc handling for hidden coercion.

- Tick appears when not selected:
  - Checkbox Off baseline missing before writes.

- Tick selected but not visible:
  - Overlay/appearance update or flatten/strip ordering is wrong.

- Text/tick disappears in viewer:
  - Output not fully flattened and stripped.

## Output Expectations

When reporting completion, always include:

1. Root cause found.
2. Files changed.
3. Verification evidence (A/B checkbox diff + flattened/no-annotation confirmation).
4. Generated output path used for proof.
