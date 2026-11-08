#!/usr/bin/env sh
# Install ProjectMusic on Linux for the current user (no sudo needed):
#   - prepares the Python environment,
#   - adds "ProjectMusic" to your app menu (with the p. icon),
#   - optionally starts the server automatically when you log in.
#
#   sh server/install-linux.sh              install
#   sh server/install-linux.sh --autostart  install + start at login
#   sh server/install-linux.sh --uninstall  remove the menu entry and autostart
set -e
DIR=$(cd "$(dirname "$0")" && pwd)
ROOT=$(dirname "$DIR")
DATA=${XDG_DATA_HOME:-$HOME/.local/share}
CONFIG=${XDG_CONFIG_HOME:-$HOME/.config}
APPS="$DATA/applications"
ICONS="$DATA/icons/hicolor/512x512/apps"
SYSTEMD="$CONFIG/systemd/user"
AUTOSTART="$CONFIG/autostart"
PORT=${PM_PORT:-8080}

has_user_systemd() {
  command -v systemctl >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1
}

refresh_menu() {
  command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$APPS" >/dev/null 2>&1 || true
  command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -q "$DATA/icons/hicolor" >/dev/null 2>&1 || true
}

if [ "$1" = "--uninstall" ]; then
  if has_user_systemd; then systemctl --user disable --now projectmusic.service >/dev/null 2>&1 || true; fi
  rm -f "$SYSTEMD/projectmusic.service" "$AUTOSTART/projectmusic-server.desktop" "$APPS/projectmusic.desktop" "$ICONS/projectmusic.png"
  refresh_menu
  echo "ProjectMusic was removed from your app menu and autostart."
  echo "The project folder itself ($ROOT) was left untouched."
  exit 0
fi

echo "1/3  Preparing ProjectMusic…"
sh "$DIR/start.sh" --prepare

echo "2/3  Adding ProjectMusic to your app menu…"
mkdir -p "$APPS" "$ICONS"
cp "$ROOT/public/icons/icon-512.png" "$ICONS/projectmusic.png"
# Paths may contain spaces: quote them as the Desktop Entry spec requires.
cat > "$APPS/projectmusic.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=ProjectMusic
GenericName=Music Player
Comment=Free, lightweight music player
Exec=sh "$DIR/linux-launch.sh"
Icon=projectmusic
Terminal=false
Categories=AudioVideo;Audio;Player;
Keywords=music;player;youtube;lyrics;
StartupNotify=true
EOF
chmod +x "$APPS/projectmusic.desktop"
refresh_menu

if [ "$1" = "--autostart" ]; then
  echo "3/3  Starting the server automatically at login…"
  if has_user_systemd; then
    mkdir -p "$SYSTEMD"
    cat > "$SYSTEMD/projectmusic.service" <<EOF
[Unit]
Description=ProjectMusic personal server
After=network-online.target

[Service]
WorkingDirectory=$DIR
ExecStart="$DIR/.venv/bin/python" "$DIR/projectmusic_server.py" --port $PORT
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
EOF
    systemctl --user daemon-reload
    systemctl --user enable --now projectmusic.service
    echo "     Server runs in the background (systemd user service)."
    echo "     Stop it: systemctl --user stop projectmusic  ·  Logs: journalctl --user -u projectmusic"
  else
    mkdir -p "$AUTOSTART"
    cat > "$AUTOSTART/projectmusic-server.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=ProjectMusic server
Exec=sh "$DIR/linux-launch.sh" --no-browser
Icon=projectmusic
Terminal=false
X-GNOME-Autostart-enabled=true
NoDisplay=true
EOF
    echo "     The server will start when you log in (desktop autostart)."
  fi
else
  echo "3/3  Done. (Tip: run with --autostart to start the server at every login.)"
fi

echo ""
echo "ProjectMusic is installed. Open it from your app menu, or run:"
echo "  sh \"$DIR/linux-launch.sh\""
echo "It opens at http://localhost:$PORT"
