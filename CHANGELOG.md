# Changelog

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
