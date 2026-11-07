@echo off
REM Windows: klik dua kali file ini untuk menyalakan ProjectMusic.
cd /d "%~dp0"
where py >nul 2>nul && (set PY=py -3) || (set PY=python)
%PY% --version >nul 2>nul || (
  echo Python belum terpasang. Unduh di https://www.python.org/downloads/ lalu centang "Add python.exe to PATH".
  pause
  exit /b 1
)
if not exist .venv (
  echo Menyiapkan ProjectMusic untuk pertama kali, sekitar 1 menit...
  %PY% -m venv .venv
)
call .venv\Scripts\activate.bat
python -m pip install -q --upgrade pip >nul 2>nul
python -m pip install -q --upgrade -r requirements.txt
python projectmusic_server.py
pause
