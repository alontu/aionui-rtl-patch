#!/usr/bin/env bash
# AionUi RTL patch uninstaller.
# Stops + disables the systemd unit (if installed), removes the patch dir, and
# reminds you to revert your aionui-webui.service binding.
# ------------------------------------------------------------------------------
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-$HOME/.local/share/aionui-rtl-patch}"
SERVICE_NAME="aionui-rtl-proxy.service"

color() { printf '\033[%sm%s\033[0m' "$1" "$2"; }
info()  { echo "$(color '0;34' '[INFO]') $*"; }
good()  { echo "$(color '0;32' '[ OK ]') $*"; }

if systemctl --user list-unit-files 2>/dev/null | grep -q "^$SERVICE_NAME"; then
  info "Stopping + disabling $SERVICE_NAME"
  systemctl --user stop    "$SERVICE_NAME" 2>/dev/null || true
  systemctl --user disable "$SERVICE_NAME" 2>/dev/null || true
  rm -f "$HOME/.config/systemd/user/$SERVICE_NAME"
  rm -f "$HOME/.config/systemd/user/default.target.wants/$SERVICE_NAME"
  systemctl --user daemon-reload 2>/dev/null || true
  good "Unit removed."
fi

if [[ -d "$INSTALL_DIR" ]]; then
  info "Removing $INSTALL_DIR"
  rm -rf "$INSTALL_DIR"
  good "Patch dir removed."
fi

cat <<'EOF'

────────────────────────────────────────────────────────────────────
Don't forget: your aionui-webui.service is still binding the internal
loopback port we set up. To return to the original setup, edit
~/.config/systemd/user/aionui-webui.service:

  • Restore "--remote" in the ExecStart command
  • Restore the original --port (typically 25808)

Then:
  systemctl --user daemon-reload
  systemctl --user restart aionui-webui.service
────────────────────────────────────────────────────────────────────
EOF
