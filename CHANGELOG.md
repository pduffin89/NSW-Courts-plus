# Changelog

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
