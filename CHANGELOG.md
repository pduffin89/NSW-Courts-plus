# Changelog

## Unreleased

- Added new project skill: `skills/nsw-court-pdf-determinism/SKILL.md`
  - Documents the confirmed checkbox/text root causes and permanent deterministic PDF output rules.
  - Includes a verification protocol for A/B checkbox checks plus flatten/no-annotation validation.
- Expanded project docs (`README.md`, `AGENTS.md`) with final PDF determinism guardrails and workflow.

## 0.3.16 - 2026-03-04

- Final checkbox determinism fix (root-cause release):
  - Removed Local Court Criminal requested-document coercion in service generation; selected docs are no longer silently replaced with `indictment_can`.
  - Service PDF normalization now starts with every checkbox field forced `Off`, then applies explicit requested states.
  - Extension PDF generation now does the same checkbox reset pass before applying selected states, preventing template default tick carryover.
  - Combined with existing flatten+overlay flow, this makes check/uncheck behavior deterministic and stable across viewers.

## 0.3.15 - 2026-03-04

- PDF output hardening (extension + service):
  - Added mandatory form flattening on every generated export so values are burned into page content.
  - Eliminates viewer-dependent disappearing text/checkbox rendering and stale visual form-state carryover.
  - Extension now fails generation explicitly if flattening support is unavailable, instead of silently outputting unflattened forms.
  - Service generation now stamps explicit checked-box overlays before stripping form interactivity so critical ticks (for example police fact sheet) remain visible in flattened outputs.

## 0.3.14 - 2026-02-20

- Supreme media form rendering fix:
  - Fixed missing applicant/case/details text on generated Supreme PDFs where only checkboxes appeared.
  - Root cause was text appearance regeneration failing without a resolved default font (`font undefined`).
  - Added explicit fallback text appearance font embedding and field appearance updates for non-signature text fields.

## 0.3.13 - 2026-02-20

- Non-party case title compaction update:
  - Criminal-style matters now prefer `R v <LastName>` formatting in the case-name field.
  - Example: `R v PAUL DOUGLAS SMITH` now writes as `R v Smith`.
  - Prevents long criminal defendant names from clipping in the non-party PDF case-name box.

## 0.3.12 - 2026-02-20

- Critical non-party PDF checkbox rendering fix:
  - Synced checkbox widget appearance states with selected values during generation.
  - Added deterministic non-party checked-box overlays and removed non-party checkbox widgets so selected boxes render visibly in all viewers.
  - Resolves District Court + police fact sheet visual unticked outputs in generated non-party PDFs.
- Local/District popup alignment with non-party template:
  - Replaced mixed document groups with a `Non-party document mode` dropdown (`Crime` or `Civil`) auto-selected from court-list jurisdiction.
  - Crime mode now exposes only template-matching crime checkboxes.
  - Civil mode now exposes only template-matching civil checkboxes.
  - Added distinct detail inputs for crime `other`, civil `pleading filed`, and civil `other document filed`.

## 0.3.11 - 2026-02-20

- Local/District reliability + signature rendering hardening:
  - Fixed non-party text field writes for fields missing/invalid `DA` by forcing a safe default field appearance before `setText`.
  - Ensured District Court and requested local/district document ticks (including police fact sheet) are consistently reflected in generated non-party PDFs.
  - Reworked signature rendering to deterministic handwritten overlays on signature lines and removed legacy signature widgets that displayed `{GENERATED SIGNATURE}`.
  - Replaced broken/unsupported signature font asset with a valid static handwriting TTF bundled in the extension.
  - Added test artifact hygiene by ignoring local `.tmp/` runs in git.

## 0.3.10 - 2026-02-20

- Local/District form reliability fixes:
  - Added bundled `fontkit` and registered it with `pdf-lib` so custom handwriting signature font embedding works reliably.
  - Reset all non-party document checkboxes to `false` before applying selections, preventing template-default ticks from overriding requested options.
  - Improved non-party jurisdiction detection by including court location signals and stronger District keyword matching.

## 0.3.9 - 2026-02-20

- Signature generation update (Supreme + Local/District):
  - Standardized signatures to generated `FirstInitial.LastName` format (for example `P.Duffin`) when no explicit signature text is set.
  - Applied bundled handwriting font (`Caveat`) to signature fields across both forms for consistent signature styling.
- PDF rendering fix:
  - Removed global appearance regeneration that was inflating font sizes in Supreme media output.
  - Kept targeted field-level appearance updates for signature fields.
- Court detection hardening:
  - Improved row-level court resolution in the popup to reduce Local-vs-District misclassification by scanning full row/cell court signals.

## 0.3.8 - 2026-02-20

- Critical PDF checkbox fix:
  - Replaced fragile `constructor.name` type checks in local PDF generation with method-based detection (`check/uncheck`, `setText`, `select`).
  - Restored reliable ticking of requested document checkboxes and always-on fields (Mode of access + Section D) in generated Supreme media forms.
  - Added `updateFieldAppearances()` call to improve checkbox rendering consistency.

## 0.3.7 - 2026-02-20

- Privacy hardening cleanup before Web Store packaging:
  - Replaced user-specific macOS launch label namespace in installer with `com.nswcourtautofill.service`.
  - Sanitized repository agent notes to remove user-specific absolute paths.
  - Stripped template PDF document metadata to generic producer/creator values.

## 0.3.6 - 2026-02-20

- Supreme popup now auto-selects `Bail applications` when listing type indicates `Bail Hearing` or `Callover (Bail)`.
- Renamed the non-bail Section C mode label to `Civil/Criminal (excl. bail)`.
- Supreme popup now hides media/non-party form-type checkboxes to match the underlying Supreme media form flow.
- Supreme bail mode now keeps `submissions by applicant` visible and uses a `specify images` detail field instead of showing non-party additional-details input.

## 0.3.5 - 2026-02-20

- Updated Supreme Court `Request Docs` popup to match Section C of the media form:
  - Added Section C mode dropdown with `Bail applications` and `All others incl. civil/criminal/appellate`.
  - `Bail applications` now exposes only Crown bundle, submissions by applicant, and selected images.
  - `All others` now exposes only originating process, transcript, exhibits, notice of appeal, and other.
  - Removed Supreme popup reliance on `indictment_can` for media selection.
- Updated Supreme media reason text to expanded open-justice wording in generated PDF output.
- Enforced Mode of access + Section D undertakings as always checked in generated Supreme media forms.
- Removed obsolete local-service host permissions from manifest as part of extension-only cleanup.

## 0.3.4 - 2026-02-20

- Fixed Chrome worker download crash by replacing `URL.createObjectURL` usage with base64 `data:` URL downloads in `chrome.downloads.download`.
- Resolves: `Generation failed: URL.createObjectURL is not a function`.

## 0.3.3 - 2026-02-20

- Removed local-service dependency for generation by moving `/generate` into the extension background worker.
- Added bundled PDF templates and bundled `pdf-lib` for in-extension form filling.
- Added automatic PDF saves to Chrome Downloads under `Court Application Forms/Generated`.
- Updated Gmail attachment pipeline to accept in-memory attachment payloads (no local attachment URLs required).
- Added `downloads` permission in the extension manifest.

## 0.3.2 - 2026-02-19

- Fixed Windows/macOS local-service error hints to avoid non-runnable quote wrapping.
- Updated unreachable-service error text to:
  - tell users to run the startup script path directly
  - include the platform-specific `service.log` path for immediate troubleshooting

## 0.3.1 - 2026-02-17

- Fixed platform startup hints so they use real user-resolved paths:
  - Windows now points to `%USERPROFILE%\\Applications\\NSW Court Autofill\\start-service.cmd`.
  - macOS now points to `$HOME/Applications/NSW Court Autofill/start-service.command`.
- Removed placeholder `<you>` paths from extension runtime errors.

## 0.3.0 - 2026-02-17

- Renamed extension to `NSW Courts+ Cross-Platform Autofill`.
- Added Windows installer support via `installer/install.ps1`.
- Added cross-platform installer auto-detection launcher via `installer/install.py`.
- Added Windows service scripts (`start-service.cmd`, `stop-service.cmd`, `open-extension.cmd`) generated during install.
- Updated background worker unreachable-service error to show OS-specific startup commands.
- Renamed packaged installer artifact to `NSW-Court-Autofill-Installer-Cross-Platform.zip`.
