$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$PayloadDir = Join-Path $ScriptDir "payload"
$AppDir = Join-Path $env:USERPROFILE "Applications\NSW Court Autofill"
$ServiceDir = Join-Path $AppDir "service"
$ExtensionDir = Join-Path $AppDir "extension"
$VenvDir = Join-Path $AppDir ".venv"
$AppDataDir = Join-Path $AppDir "data"
$AppFormsDir = Join-Path $AppDataDir "forms"
$AppOutputDir = Join-Path $AppDataDir "Generated"
$ProfileFile = Join-Path $AppDataDir "profile.json"
$DocsRoot = Join-Path $env:USERPROFILE "Documents\Court Application Forms"
$DocsGeneratedPath = Join-Path $DocsRoot "Generated"

if (!(Test-Path (Join-Path $PayloadDir "service")) -or !(Test-Path (Join-Path $PayloadDir "extension"))) {
    throw "Installer payload missing."
}

New-Item -ItemType Directory -Path $AppDir, $ServiceDir, $ExtensionDir, $AppDataDir, $AppFormsDir, $AppOutputDir, $DocsRoot, $DocsGeneratedPath -Force | Out-Null

if (Test-Path $ServiceDir) { Remove-Item $ServiceDir -Recurse -Force }
if (Test-Path $ExtensionDir) { Remove-Item $ExtensionDir -Recurse -Force }
Copy-Item (Join-Path $PayloadDir "service") $ServiceDir -Recurse -Force
Copy-Item (Join-Path $PayloadDir "extension") $ExtensionDir -Recurse -Force

$legacyFormA = Join-Path $DocsRoot "access_application_2026.pdf"
$legacyFormB = Join-Path $DocsRoot "Application by non-party for access to court file.pdf"
$legacyProfile = Join-Path $DocsRoot ".autofill-config.json"
$legacyOauth = Join-Path $DocsRoot "gmail-oauth-client.json"
$legacyToken = Join-Path $DocsRoot ".gmail-token.json"

if ((Test-Path $legacyFormA) -and !(Test-Path (Join-Path $AppFormsDir "access_application_2026.pdf"))) {
    Copy-Item $legacyFormA (Join-Path $AppFormsDir "access_application_2026.pdf") -Force
}
if ((Test-Path $legacyFormB) -and !(Test-Path (Join-Path $AppFormsDir "Application by non-party for access to court file.pdf"))) {
    Copy-Item $legacyFormB (Join-Path $AppFormsDir "Application by non-party for access to court file.pdf") -Force
}
if ((Test-Path $legacyProfile) -and !(Test-Path $ProfileFile)) {
    Copy-Item $legacyProfile $ProfileFile -Force
}
if ((Test-Path $legacyOauth) -and !(Test-Path (Join-Path $AppDataDir "gmail-oauth-client.json"))) {
    Copy-Item $legacyOauth (Join-Path $AppDataDir "gmail-oauth-client.json") -Force
}
if ((Test-Path $legacyToken) -and !(Test-Path (Join-Path $AppDataDir ".gmail-token.json"))) {
    Copy-Item $legacyToken (Join-Path $AppDataDir ".gmail-token.json") -Force
}

if (!(Test-Path $VenvDir)) {
    if (Get-Command py -ErrorAction SilentlyContinue) {
        & py -3 -m venv $VenvDir
    } elseif (Get-Command python -ErrorAction SilentlyContinue) {
        & python -m venv $VenvDir
    } else {
        throw "Python 3 not found. Install Python 3 and rerun install.ps1."
    }
}

$VenvPython = Join-Path $VenvDir "Scripts\python.exe"
if (!(Test-Path $VenvPython)) {
    throw "Virtual environment Python not found at $VenvPython"
}

& $VenvPython -m pip install --upgrade pip | Out-Null
& $VenvPython -m pip install -r (Join-Path $ServiceDir "requirements.txt")

$runServicePath = Join-Path $AppDir "run-service.ps1"
$startPs1Path = Join-Path $AppDir "start-service.ps1"
$stopPs1Path = Join-Path $AppDir "stop-service.ps1"
$openPs1Path = Join-Path $AppDir "open-extension.ps1"

$runServiceScript = @'
$ErrorActionPreference = "Stop"
$AppDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ServiceDir = Join-Path $AppDir "service"
$VenvPython = Join-Path $AppDir ".venv\Scripts\python.exe"
$AppDataDir = Join-Path $AppDir "data"
$AppFormsDir = Join-Path $AppDataDir "forms"
$ProfileFile = Join-Path $AppDataDir "profile.json"
$DocsRoot = Join-Path $env:USERPROFILE "Documents\Court Application Forms"
$DocsGeneratedPath = Join-Path $DocsRoot "Generated"
New-Item -ItemType Directory -Path $DocsGeneratedPath, $AppFormsDir -Force | Out-Null

$env:AUTOFILL_APP_HOME = $AppDir
$env:AUTOFILL_DATA_ROOT = $AppDataDir
$env:AUTOFILL_FORM_ROOT = $AppFormsDir
$env:AUTOFILL_OUTPUT_ROOT = $DocsGeneratedPath
$env:AUTOFILL_CONFIG_PATH = $ProfileFile
$env:GMAIL_OAUTH_CLIENT_FILE = Join-Path $AppDataDir "gmail-oauth-client.json"
$env:GMAIL_TOKEN_FILE = Join-Path $AppDataDir ".gmail-token.json"

Set-Location $ServiceDir
& $VenvPython -m uvicorn main:app --host 127.0.0.1 --port 8765 --app-dir $ServiceDir
'@

$startServiceScript = @'
$ErrorActionPreference = "Stop"
$AppDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$HealthUrl = "http://127.0.0.1:8765/health"
$RunServicePath = Join-Path $AppDir "run-service.ps1"
$LogPath = Join-Path $AppDir "service.log"

try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $HealthUrl -TimeoutSec 2
    if ($response.StatusCode -eq 200) {
        Write-Host "Service already healthy on port 8765. Restarting to apply latest config."
    }
} catch {
}

try {
    $conn = Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction Stop | Select-Object -First 1
    if ($conn -and $conn.OwningProcess) {
        Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 1
    }
} catch {
}

Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$RunServicePath`"") -WindowStyle Hidden -RedirectStandardOutput $LogPath -RedirectStandardError $LogPath

for ($i = 0; $i -lt 12; $i++) {
    Start-Sleep -Seconds 1
    try {
        $check = Invoke-WebRequest -UseBasicParsing -Uri $HealthUrl -TimeoutSec 2
        if ($check.StatusCode -eq 200) {
            Write-Host "Service started: http://127.0.0.1:8765"
            Write-Host "Log: $LogPath"
            exit 0
        }
    } catch {
    }
}

Write-Host "Service failed to become healthy."
Write-Host "Log: $LogPath"
exit 1
'@

$stopServiceScript = @'
$ErrorActionPreference = "Continue"
try {
    $conn = Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction Stop | Select-Object -First 1
    if ($conn -and $conn.OwningProcess) {
        Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
    }
} catch {
    $lines = netstat -ano | Select-String ":8765"
    foreach ($line in $lines) {
        $parts = ($line -replace "\s+", " ").Trim().Split(" ")
        if ($parts.Length -ge 5) {
            $pid = $parts[$parts.Length - 1]
            if ($pid -match "^\d+$") {
                taskkill /PID $pid /F | Out-Null
            }
        }
    }
}
Write-Host "Service stopped."
'@

$openExtensionScript = @'
$ErrorActionPreference = "Stop"
$AppDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ExtensionDir = Join-Path $AppDir "extension"
Start-Process explorer.exe $ExtensionDir
Start-Process "chrome.exe" "chrome://extensions"
Write-Host "Load unpacked extension from: $ExtensionDir"
'@

Set-Content -Path $runServicePath -Value $runServiceScript -Encoding Ascii
Set-Content -Path $startPs1Path -Value $startServiceScript -Encoding Ascii
Set-Content -Path $stopPs1Path -Value $stopServiceScript -Encoding Ascii
Set-Content -Path $openPs1Path -Value $openExtensionScript -Encoding Ascii

$startCmd = "@echo off`r`npowershell -NoProfile -ExecutionPolicy Bypass -File ""%~dp0start-service.ps1""`r`n"
$stopCmd = "@echo off`r`npowershell -NoProfile -ExecutionPolicy Bypass -File ""%~dp0stop-service.ps1""`r`n"
$openCmd = "@echo off`r`npowershell -NoProfile -ExecutionPolicy Bypass -File ""%~dp0open-extension.ps1""`r`n"

Set-Content -Path (Join-Path $AppDir "start-service.cmd") -Value $startCmd -Encoding Ascii
Set-Content -Path (Join-Path $AppDir "stop-service.cmd") -Value $stopCmd -Encoding Ascii
Set-Content -Path (Join-Path $AppDir "open-extension.cmd") -Value $openCmd -Encoding Ascii

& (Join-Path $AppDir "start-service.cmd")
& (Join-Path $AppDir "open-extension.cmd")

Write-Host ""
Write-Host "Install complete."
Write-Host "App folder: $AppDir"
Write-Host "Data folder: $AppDataDir"
Write-Host "Generated output: $DocsGeneratedPath"
Write-Host "Service script: $(Join-Path $AppDir 'start-service.cmd')"
Write-Host "Extension path: $ExtensionDir"
Write-Host "Templates folder: $AppFormsDir"
