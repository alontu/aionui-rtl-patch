#!/usr/bin/env bash
# AionUi RTL patch installer.
# Drops files, optionally installs a systemd --user service, prints next-step
# instructions for rebinding aionui-web to loopback.
# ------------------------------------------------------------------------------
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-$HOME/.local/share/aionui-rtl-patch}"
EXTERNAL_PORT="${EXTERNAL_PORT:-25808}"     # public port your browser hits
INTERNAL_PORT="${INTERNAL_PORT:-25807}"     # loopback port aionui-web should bind
INSTALL_SYSTEMD="${INSTALL_SYSTEMD:-yes}"   # set to "no" to skip systemd unit
SERVICE_NAME="aionui-rtl-proxy.service"
NODE_BIN="${NODE_BIN:-$(command -v node || true)}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

color()  { printf '\033[%sm%s\033[0m' "$1" "$2"; }
info()   { echo "$(color '0;34' '[INFO]') $*"; }
good()   { echo "$(color '0;32' '[ OK ]') $*"; }
warn()   { echo "$(color '1;33' '[WARN]') $*"; }
die()    { echo "$(color '0;31' '[FAIL]') $*" >&2; exit 1; }

banner() {
  cat <<'EOF'
  ╔════════════════════════════════════════════════════╗
  ║  AionUi RTL Patch — Hebrew right-to-left support   ║
  ║  for the iOfficeAI/AionUi WebUI (no source edits)  ║
  ╚════════════════════════════════════════════════════╝
EOF
}

check_prereqs() {
  if [[ -z "$NODE_BIN" || ! -x "$NODE_BIN" ]]; then
    die "Node.js not found on PATH. Install Node 16+ (any LTS works) and re-run, or set NODE_BIN=/path/to/node."
  fi
  local nodever
  nodever="$($NODE_BIN -e 'console.log(process.versions.node)')"
  info "Node binary: $NODE_BIN (v$nodever)"
}

copy_files() {
  info "Installing patch files to $INSTALL_DIR"
  mkdir -p "$INSTALL_DIR"
  for f in proxy.js rtl.css rtl.js; do
    [[ -f "$SCRIPT_DIR/$f" ]] || die "$f missing from installer payload at $SCRIPT_DIR"
    install -m 0644 "$SCRIPT_DIR/$f" "$INSTALL_DIR/$f"
  done
  good "Files in place:"
  ls -la "$INSTALL_DIR" | awk 'NR>1 {print "       " $0}'
}

install_systemd_unit() {
  local unit_dir="$HOME/.config/systemd/user"
  local unit_path="$unit_dir/$SERVICE_NAME"
  mkdir -p "$unit_dir"
  info "Installing systemd --user unit: $unit_path"

  # Substitute env vars into the template.
  sed \
    -e "s|@NODE_BIN@|$NODE_BIN|g" \
    -e "s|@INSTALL_DIR@|$INSTALL_DIR|g" \
    -e "s|@EXTERNAL_PORT@|$EXTERNAL_PORT|g" \
    -e "s|@INTERNAL_PORT@|$INTERNAL_PORT|g" \
    "$SCRIPT_DIR/aionui-rtl-proxy.service" > "$unit_path"

  if command -v systemctl >/dev/null 2>&1; then
    systemctl --user daemon-reload || warn "daemon-reload failed; you may need to run it manually."
    systemctl --user enable "$SERVICE_NAME" || warn "enable failed; running interactive?"
    good "Unit installed and enabled."
  else
    warn "systemctl not available — unit written to $unit_path but not enabled."
  fi
}

print_next_steps() {
  cat <<EOF

$(color '1;36' '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
$(color '1;36' '  Next steps')
$(color '1;36' '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

1. Re-bind aionui-web to loopback:$INTERNAL_PORT
   (the RTL proxy will listen on :$EXTERNAL_PORT and forward to it).

   If you run aionui-web via systemd --user:
     • Edit  ~/.config/systemd/user/aionui-webui.service
     • Change ExecStart to drop "--remote" and use --port $INTERNAL_PORT
     • Reload + restart:
         systemctl --user daemon-reload
         systemctl --user restart aionui-webui.service

   If you run aionui-web interactively:
     • Stop it (Ctrl+C)
     • Restart with:  aionui-web start --no-open --port $INTERNAL_PORT

2. Start the proxy:
EOF
  if [[ "$INSTALL_SYSTEMD" == "yes" ]]; then
    cat <<EOF
     systemctl --user start  $SERVICE_NAME
     systemctl --user status $SERVICE_NAME
EOF
  else
    cat <<EOF
     $NODE_BIN $INSTALL_DIR/proxy.js
     (configure with env vars: RTL_LISTEN_PORT=$EXTERNAL_PORT
      RTL_UPSTREAM_PORT=$INTERNAL_PORT)
EOF
  fi

  cat <<EOF

3. Open AionUi in your browser at port $EXTERNAL_PORT (unchanged URL).
   You should see the same WebUI as before, now with Hebrew content
   automatically right-to-left.

4. Verify in DevTools console:
     [aionui-rtl] v5 loaded — draining shadow queue and walking
     [aionui-rtl] initial — light-marked N shadowsTreated: M adoptedStyleSheets: true

5. Optional toggles:
     • Disable per-tab:  append "?nortl=1" to the URL
     • Disable per-browser:  open console, run  aionuiRtl.disable()
     • Re-enable:           aionuiRtl.enable()
     • Diagnostic state:    aionuiRtl.debug()

6. To uninstall later:  ./uninstall.sh
EOF
}

main() {
  banner
  check_prereqs
  copy_files
  if [[ "$INSTALL_SYSTEMD" == "yes" ]]; then
    install_systemd_unit
  else
    info "Skipping systemd unit install (INSTALL_SYSTEMD=no)."
  fi
  print_next_steps
  good "Install complete."
}

main "$@"
