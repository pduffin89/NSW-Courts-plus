# Document Applications

The Documents tab builds a validated application payload from detected matter metadata and applicant profile fields. The background service worker also exposes `COURTLENS_GENERATE_DOCUMENTS`, which fills bundled PDF templates with `pdf-lib` and returns PDF attachments as base64 payloads.

## Included assets

Copied from the mature NSW Courts+ extension:

- `forms/access_application_2026.pdf`
- `forms/application_non_party_access.pdf`
- `vendor/pdf-lib.min.js`
- `vendor/fontkit.umd.min.js`

These files are copied into `dist/` by Vite's `publicDir`.

## Recipient routing

`resolveCourtRecipient()` routes common court names to email addresses:

- Supreme Court
- District Court
- Local Court
- Children's Court
- Coroner's Court

Unknown courts use a safe generic fallback.

## PDF generation

`extension/src/documents/pdfGeneration.ts` loads the bundled templates, fills matching AcroForm text fields and checkboxes, attempts to flatten outputs, and safely falls back to a filled unflattened PDF when a legacy template has orphan widget references.

The implementation preserves the key guardrails available in this Vite build:

- no network dependency for templates
- no hardcoded applicant or provider secrets
- deterministic generated PDF names
- checkbox fields are unchecked unless selected or required acknowledgements
- generation is covered by tests against the real bundled templates
