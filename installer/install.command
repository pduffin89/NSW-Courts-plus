#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PAYLOAD_DIR="$SCRIPT_DIR/payload"
APP_DIR="$HOME/Applications/NSW Court Autofill"
SERVICE_DIR="$APP_DIR/service"
EXTENSION_DIR="$APP_DIR/extension"
VENV_DIR="$APP_DIR/.venv"
APP_DATA_DIR="$APP_DIR/data"
APP_FORMS_DIR="$APP_DATA_DIR/forms"
APP_OUTPUT_DIR="$APP_DATA_DIR/Generated"
PROFILE_FILE="$APP_DATA_DIR/profile.json"
LEGACY_FORM_ROOT="$HOME/Documents/Court Application Forms"
DOCS_FORM_ROOT="$HOME/Documents/Court Application Forms"
DOCS_GENERATED_PATH="$DOCS_FORM_ROOT/Generated"
LAUNCH_LABEL="com.perry.nswcourtautofill"
LAUNCH_PLIST="$HOME/Library/LaunchAgents/$LAUNCH_LABEL.plist"

if [ ! -d "$PAYLOAD_DIR/service" ] || [ ! -d "$PAYLOAD_DIR/extension" ]; then
  echo "Installer payload missing."
  exit 1
fi

mkdir -p "$APP_DIR" "$SERVICE_DIR" "$EXTENSION_DIR"
mkdir -p "$APP_DATA_DIR" "$APP_FORMS_DIR" "$APP_OUTPUT_DIR"
mkdir -p "$DOCS_FORM_ROOT"

rsync -a --delete "$PAYLOAD_DIR/service/" "$SERVICE_DIR/"
rsync -a --delete "$PAYLOAD_DIR/extension/" "$EXTENSION_DIR/"

# One-time migration from legacy Documents-based paths into app-local storage.
if [ -f "$LEGACY_FORM_ROOT/access_application_2026.pdf" ] && [ ! -f "$APP_FORMS_DIR/access_application_2026.pdf" ]; then
  cp "$LEGACY_FORM_ROOT/access_application_2026.pdf" "$APP_FORMS_DIR/access_application_2026.pdf"
fi
if [ -f "$LEGACY_FORM_ROOT/Application by non-party for access to court file.pdf" ] && [ ! -f "$APP_FORMS_DIR/Application by non-party for access to court file.pdf" ]; then
  cp "$LEGACY_FORM_ROOT/Application by non-party for access to court file.pdf" "$APP_FORMS_DIR/Application by non-party for access to court file.pdf"
fi
if [ -f "$LEGACY_FORM_ROOT/.autofill-config.json" ] && [ ! -f "$PROFILE_FILE" ]; then
  cp "$LEGACY_FORM_ROOT/.autofill-config.json" "$PROFILE_FILE"
fi
if [ -f "$LEGACY_FORM_ROOT/gmail-oauth-client.json" ] && [ ! -f "$APP_DATA_DIR/gmail-oauth-client.json" ]; then
  cp "$LEGACY_FORM_ROOT/gmail-oauth-client.json" "$APP_DATA_DIR/gmail-oauth-client.json"
fi
if [ -f "$LEGACY_FORM_ROOT/.gmail-token.json" ] && [ ! -f "$APP_DATA_DIR/.gmail-token.json" ]; then
  cp "$LEGACY_FORM_ROOT/.gmail-token.json" "$APP_DATA_DIR/.gmail-token.json"
fi

# Make generated files easy to find in Documents without requiring the
# background service to access protected Documents directories.
link_docs_generated() {
  if [ -L "$DOCS_GENERATED_PATH" ]; then
    CURRENT_TARGET="$(readlink "$DOCS_GENERATED_PATH" || true)"
    if [ "$CURRENT_TARGET" != "$APP_OUTPUT_DIR" ]; then
      rm -f "$DOCS_GENERATED_PATH"
      ln -s "$APP_OUTPUT_DIR" "$DOCS_GENERATED_PATH"
    fi
    return 0
  fi

  if [ -d "$DOCS_GENERATED_PATH" ]; then
    if find "$DOCS_GENERATED_PATH" -mindepth 1 -maxdepth 1 | read -r _; then
      BACKUP_PATH="$DOCS_FORM_ROOT/Generated_legacy_$(date +%Y%m%d_%H%M%S)"
      mv "$DOCS_GENERATED_PATH" "$BACKUP_PATH"
      echo "Moved existing Documents Generated folder to: $BACKUP_PATH"
    else
      rmdir "$DOCS_GENERATED_PATH"
    fi
  elif [ -e "$DOCS_GENERATED_PATH" ]; then
    rm -f "$DOCS_GENERATED_PATH"
  fi

  ln -s "$APP_OUTPUT_DIR" "$DOCS_GENERATED_PATH"
}

link_docs_generated || true

if [ ! -d "$VENV_DIR" ]; then
  python3 -m venv "$VENV_DIR"
fi

"$VENV_DIR/bin/pip" install --upgrade pip >/dev/null
"$VENV_DIR/bin/pip" install -r "$SERVICE_DIR/requirements.txt"

mkdir -p "$HOME/Library/LaunchAgents"
cat > "$LAUNCH_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LAUNCH_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$VENV_DIR/bin/python</string>
    <string>-m</string>
    <string>uvicorn</string>
    <string>main:app</string>
    <string>--host</string>
    <string>127.0.0.1</string>
    <string>--port</string>
    <string>8765</string>
    <string>--app-dir</string>
    <string>$SERVICE_DIR</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$SERVICE_DIR</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>AUTOFILL_APP_HOME</key>
    <string>$APP_DIR</string>
    <key>AUTOFILL_DATA_ROOT</key>
    <string>$APP_DATA_DIR</string>
    <key>AUTOFILL_FORM_ROOT</key>
    <string>$APP_FORMS_DIR</string>
    <key>AUTOFILL_OUTPUT_ROOT</key>
    <string>$APP_OUTPUT_DIR</string>
    <key>AUTOFILL_CONFIG_PATH</key>
    <string>$PROFILE_FILE</string>
    <key>GMAIL_OAUTH_CLIENT_FILE</key>
    <string>$APP_DATA_DIR/gmail-oauth-client.json</string>
    <key>GMAIL_TOKEN_FILE</key>
    <string>$APP_DATA_DIR/.gmail-token.json</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$APP_DIR/service.log</string>
  <key>StandardErrorPath</key>
  <string>$APP_DIR/service.log</string>
</dict>
</plist>
EOF

cat > "$APP_DIR/start-service.command" <<EOF
#!/bin/bash
set -euo pipefail
APP_DIR="$APP_DIR"
LOG_FILE="\$APP_DIR/service.log"
HEALTH_URL="http://127.0.0.1:8765/health"
LAUNCH_LABEL="$LAUNCH_LABEL"
LAUNCH_PLIST="$LAUNCH_PLIST"
APP_FORMS_DIR="$APP_FORMS_DIR"

# If port is occupied by a stale/old process, release it.
if lsof -n -iTCP:8765 -sTCP:LISTEN >/dev/null 2>&1; then
  if curl -fsS "\$HEALTH_URL" >/dev/null 2>&1; then
    echo "Service already healthy on port 8765. Restarting to apply latest config."
  else
    OLD_PID="\$(lsof -t -iTCP:8765 -sTCP:LISTEN | head -n 1)"
    if [ -n "\$OLD_PID" ]; then
      kill "\$OLD_PID" >/dev/null 2>&1 || true
      sleep 1
    fi
  fi
fi

launchctl bootout "gui/\$(id -u)" "\$LAUNCH_PLIST" >/dev/null 2>&1 || true
launchctl bootstrap "gui/\$(id -u)" "\$LAUNCH_PLIST"
launchctl kickstart -k "gui/\$(id -u)/\$LAUNCH_LABEL"

for _ in {1..10}; do
  if curl -fsS "\$HEALTH_URL" >/dev/null 2>&1; then
    echo "Service started: http://127.0.0.1:8765"
    echo "Log: \$LOG_FILE"
    exit 0
  fi
  sleep 1
done

echo "Service failed to become healthy."
echo "Log: \$LOG_FILE"
echo "Templates expected in: \$APP_FORMS_DIR"
tail -n 80 "\$LOG_FILE" 2>/dev/null || true
exit 1
EOF

cat > "$APP_DIR/stop-service.command" <<EOF
#!/bin/bash
set -euo pipefail
APP_DIR="$APP_DIR"
LAUNCH_PLIST="$LAUNCH_PLIST"
LAUNCH_LABEL="$LAUNCH_LABEL"
launchctl bootout "gui/\$(id -u)" "\$LAUNCH_PLIST" >/dev/null 2>&1 || true

if lsof -n -iTCP:8765 -sTCP:LISTEN >/dev/null 2>&1; then
  RUN_PID="\$(lsof -t -iTCP:8765 -sTCP:LISTEN | head -n 1)"
  kill "\$RUN_PID" >/dev/null 2>&1 || true
fi
echo "Service stopped."
EOF

cat > "$APP_DIR/open-extension.command" <<EOF
#!/bin/bash
set -euo pipefail
APP_DIR="$APP_DIR"
open "\$APP_DIR/extension"
open -a "Google Chrome" "chrome://extensions"
echo "Load unpacked extension from: \$APP_DIR/extension"
EOF

chmod +x "$APP_DIR/start-service.command" "$APP_DIR/stop-service.command" "$APP_DIR/open-extension.command"

"$APP_DIR/start-service.command" || true
"$APP_DIR/open-extension.command" || true

echo ""
echo "Install complete."
echo "App folder: $APP_DIR"
echo "Data folder: $APP_DATA_DIR"
echo "Documents shortcut: $DOCS_GENERATED_PATH -> $APP_OUTPUT_DIR"
echo "Service script: $APP_DIR/start-service.command"
echo "Extension path: $APP_DIR/extension"
echo "Templates folder: $APP_FORMS_DIR"
echo ""
echo "Next:"
echo "1) In Chrome extensions page, enable Developer Mode."
echo "2) Click Load unpacked and select: $APP_DIR/extension"
echo "3) Open NSW court list page and click Generate Application."
