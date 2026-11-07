#!/usr/bin/env sh
# Menyalakan server ProjectMusic (Linux, Mac, dan Android/Termux).
# Pertama kali: otomatis membuat lingkungan Python & memasang library.
set -e
cd "$(dirname "$0")"

if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3 belum terpasang."
  echo "  Termux : pkg install python"
  echo "  Mac    : https://www.python.org/downloads/"
  echo "  Linux  : sudo apt install python3 python3-venv"
  exit 1
fi

if [ ! -d .venv ]; then
  echo "Menyiapkan ProjectMusic untuk pertama kali (sekitar 1 menit)..."
  python3 -m venv .venv
fi
. .venv/bin/activate
# Selalu perbarui yt-dlp: YouTube sering berubah, versi baru biasanya memperbaikinya.
python -m pip install -q --upgrade pip >/dev/null 2>&1 || true
python -m pip install -q --upgrade -r requirements.txt

exec python projectmusic_server.py "$@"
