#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
# Install X Monitor as a macOS LaunchAgent so it starts at login and stays up.
#   Install:   npm run autostart
#   Remove:    npm run autostart:remove
#
# This script VERIFIES the agent actually loaded and is serving before it
# claims success. An earlier version printed a checkmark unconditionally,
# which hid a failed load behind a success message.
# ═══════════════════════════════════════════════════════════════════════════
set -uo pipefail

LABEL="com.xmonitor.local"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UID_NUM="$(id -u)"
TARGET="gui/$UID_NUM"
PORT="${PORT:-3000}"

if [[ "${1:-}" == "--uninstall" ]]; then
  launchctl bootout "$TARGET/$LABEL" 2>/dev/null
  launchctl unload "$PLIST" 2>/dev/null
  rm -f "$PLIST"
  echo "✓ Autostart removed. X Monitor will no longer start at login."
  exit 0
fi

NODE_BIN="$(command -v node || true)"
if [[ -z "$NODE_BIN" ]]; then
  echo "✖ node not found on PATH." >&2
  exit 1
fi

echo "• node:    $NODE_BIN"
echo "• project: $ROOT"
echo "• plist:   $PLIST"
echo

mkdir -p "$HOME/Library/LaunchAgents" "$ROOT/.data" "$ROOT/logs"

cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>$ROOT/scripts/run-local.mjs</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$ROOT</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>$(dirname "$NODE_BIN"):/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
    <key>NODE_ENV</key>
    <string>production</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>$ROOT/logs/xmonitor.out.log</string>
  <key>StandardErrorPath</key>
  <string>$ROOT/logs/xmonitor.err.log</string>
</dict>
</plist>
PLISTEOF

chmod 644 "$PLIST"

# Validate the plist before handing it to launchd — a malformed one is a
# common cause of the opaque "Input/output error".
if ! plutil -lint "$PLIST" >/dev/null; then
  echo "✖ Generated plist is malformed:" >&2
  plutil -lint "$PLIST" >&2
  exit 1
fi
echo "✓ plist is valid"

# Clear any previous copy, and un-disable the label. A label left in the
# 'disabled' state makes bootstrap fail with EIO (error 5) no matter what.
launchctl bootout "$TARGET/$LABEL" 2>/dev/null
launchctl enable "$TARGET/$LABEL" 2>/dev/null

echo "• bootstrapping…"
BOOT_ERR="$(launchctl bootstrap "$TARGET" "$PLIST" 2>&1)"
BOOT_RC=$?

if [[ $BOOT_RC -ne 0 ]]; then
  echo "  bootstrap said: ${BOOT_ERR:-(no message)} (rc=$BOOT_RC)"
  echo "• falling back to legacy load…"
  LOAD_ERR="$(launchctl load -w "$PLIST" 2>&1)"
  echo "  load said: ${LOAD_ERR:-ok}"
fi

# ── Verify, do not assume ────────────────────────────────────────────────
echo
if ! launchctl list | grep -q "$LABEL"; then
  echo "✖ The agent is NOT registered with launchd."
  echo
  echo "  Diagnose with:"
  echo "    launchctl print $TARGET/$LABEL"
  echo
  echo "  In the meantime this still works, it just needs a terminal open:"
  echo "    cd $ROOT && npm run local"
  exit 1
fi

echo "✓ Registered with launchd:"
launchctl list | grep "$LABEL" | sed 's/^/    /'

echo
echo "• waiting for the server to answer on port $PORT…"
OK=0
for i in $(seq 1 30); do
  if curl -fsS --max-time 2 "http://127.0.0.1:$PORT/api/twitter-webhook" >/dev/null 2>&1; then
    OK=1
    break
  fi
  sleep 2
done

if [[ $OK -eq 1 ]]; then
  echo "✓ Server is up and answering."
  echo "✓ X Monitor now starts at login and restarts if it crashes."
else
  echo "⚠ Registered, but nothing is answering on port $PORT yet."
  echo "  A first build can take a couple of minutes — check the log:"
  echo "    tail -f $ROOT/logs/xmonitor.out.log"
fi

echo
echo "  Status : launchctl list | grep $LABEL"
echo "  Logs   : tail -f $ROOT/logs/xmonitor.out.log"
echo "  Errors : tail -f $ROOT/logs/xmonitor.err.log"
echo "  Remove : npm run autostart:remove"
