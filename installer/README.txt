NSW Court Autofill Installer

Recommended (auto-detect OS)
- Run: python install.py
- macOS runs install.command automatically.
- Windows runs install.ps1 automatically.

macOS
1. Double-click install.command
2. Chrome opens extensions page
3. Click "Load unpacked" and select:
   ~/Applications/NSW Court Autofill/extension

After install:
- Start service: ~/Applications/NSW Court Autofill/start-service.command
- Stop service:  ~/Applications/NSW Court Autofill/stop-service.command
- Open extension folder/page: ~/Applications/NSW Court Autofill/open-extension.command

Windows (PowerShell)
1. Right-click install.ps1 and run with PowerShell
   (or run in terminal: powershell -ExecutionPolicy Bypass -File .\install.ps1)
2. Chrome opens extensions page
3. Click "Load unpacked" and select:
   %USERPROFILE%\Applications\NSW Court Autofill\extension

After install:
- Start service: %USERPROFILE%\Applications\NSW Court Autofill\start-service.cmd
- Stop service:  %USERPROFILE%\Applications\NSW Court Autofill\stop-service.cmd
- Open extension folder/page: %USERPROFILE%\Applications\NSW Court Autofill\open-extension.cmd
