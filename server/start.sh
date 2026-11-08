#!/usr/bin/env sh
# Start the ProjectMusic server (Linux, Mac and Android/Termux).
# First run: creates a private Python environment and installs the libraries.
set -e
cd "$(dirname "$0")"

# Tell people exactly what to install on their system.
hint_python() {
  if command -v apt-get >/dev/null 2>&1; then echo "  sudo apt install python3 python3-venv python3-pip"
  elif command -v dnf >/dev/null 2>&1; then echo "  sudo dnf install python3 python3-pip"
  elif command -v pacman >/dev/null 2>&1; then echo "  sudo pacman -S python python-pip"
  elif command -v zypper >/dev/null 2>&1; then echo "  sudo zypper install python3 python3-pip"
  elif command -v pkg >/dev/null 2>&1; then echo "  pkg install python"
  else echo "  Install Python 3.10 or newer from https://www.python.org/downloads/"
  fi
}

if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3 is not installed. Install it with:"
  hint_python
  exit 1
fi

if ! python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)'; then
  echo "ProjectMusic needs Python 3.10 or newer (found $(python3 -V 2>&1))."
  hint_python
  exit 1
fi

if [ ! -x .venv/bin/python ]; then
  echo "Setting up ProjectMusic for the first time (about a minute)..."
  rm -rf .venv
  if ! python3 -m venv .venv >/dev/null 2>&1; then
    rm -rf .venv
    echo "Python's 'venv' module is missing. Install it with:"
    hint_python
    exit 1
  fi
fi
. .venv/bin/activate
# Always update yt-dlp: YouTube changes often and new versions usually fix playback.
python -m pip install -q --upgrade pip >/dev/null 2>&1 || true
python -m pip install -q --upgrade -r requirements.txt

# "--prepare": only set things up (used by install-linux.sh), don't start the server.
if [ "$1" = "--prepare" ]; then echo "ProjectMusic is ready."; exit 0; fi

exec python projectmusic_server.py "$@"
