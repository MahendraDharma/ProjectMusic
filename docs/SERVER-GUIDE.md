# ProjectMusic personal server guide

*Versi Bahasa Indonesia: [PANDUAN-SERVER.md](PANDUAN-SERVER.md)*

The personal server lets ProjectMusic play **songs from the YouTube Music catalogue**:
charts, search, artist pages, autoplay radio, synced lyrics and downloads.

> **Why on your own device?** YouTube blocks requests from cloud servers and hosting
> ("Sign in to confirm you're not a bot"). From a normal home connection or mobile data
> there is no block. Apps like BitChord work the same way: they run on the listener's phone.
>
> Use it for **personal listening** only. Don't expose this server to the public internet.

---

## 1. Laptop / PC

### Windows
1. Install **Python 3** from <https://www.python.org/downloads/> and tick **"Add python.exe to PATH"**.
2. Download ProjectMusic: green **Code → Download ZIP** button on GitHub, then extract it.
3. Open the `server` folder and **double-click `start.bat`**. The first run takes about a minute.
4. Open <http://localhost:8080>.

### Mac
1. Install **Python 3** from <https://www.python.org/downloads/>.
2. Download and extract ProjectMusic as above.
3. Open **Terminal** and run (adjust the folder location):
   ```bash
   cd ~/Downloads/ProjectMusic-main && sh server/start.sh
   ```
   Or double-click `server/start.command` (if macOS refuses: right-click → **Open** → **Open**).
4. Open <http://localhost:8080>.

### Linux (Ubuntu, Debian, Fedora, Arch, Mint, …)
1. Make sure Python 3.10+ is installed. If the installer says something is missing, it prints the exact
   command for your distribution, for example on Ubuntu/Debian:
   ```bash
   sudo apt install python3 python3-venv python3-pip
   ```
2. Download ProjectMusic (green **Code → Download ZIP**, then extract), or clone it:
   ```bash
   git clone https://github.com/MahendraDharma/ProjectMusic
   ```
3. Install it for your user (no sudo needed). It adds **ProjectMusic** to your app menu with its icon:
   ```bash
   sh ProjectMusic/server/install-linux.sh
   ```
   Want the server to start automatically every time you log in? Use this instead:
   ```bash
   sh ProjectMusic/server/install-linux.sh --autostart
   ```
4. Open **ProjectMusic** from your app menu (GNOME, KDE, Xfce, Cinnamon…). The server starts in the background
   and your browser opens <http://localhost:8080>. In Chrome or Edge you can also press **Install** in the
   address bar to get its own window.

Useful commands:

| What | Command |
|---|---|
| Start without the menu | `sh ProjectMusic/server/linux-launch.sh` |
| Run in the terminal (see logs) | `sh ProjectMusic/server/start.sh` |
| Stop the autostart service | `systemctl --user stop projectmusic` |
| Remove menu entry and autostart | `sh ProjectMusic/server/install-linux.sh --uninstall` |

With `--autostart` the server runs as a systemd user service when available (logs:
`journalctl --user -u projectmusic`), otherwise through your desktop's autostart. The launcher's log is
in `server/server.log`.

## 2. Android phone (Termux)

Good for an old Android phone that can stay plugged in.

1. Install **Termux** from [F-Droid](https://f-droid.org/packages/com.termux/) (the Play Store version is outdated).
2. In Termux, run one at a time:
   ```bash
   pkg install -y python git
   ```
   ```bash
   git clone https://github.com/MahendraDharma/ProjectMusic
   ```
   ```bash
   sh ProjectMusic/server/start.sh
   ```
3. Open <http://localhost:8080> in Chrome on that phone.
4. To keep Android from stopping it with the screen off: pull down the Termux notification → **Acquire wakelock**.

## 3. Using it from other phones (iPhone / Android)

When the server runs it prints an address like:

```
• Dari HP lain (Wi-Fi sama): http://192.168.1.5:8080
```

- **At home (same Wi-Fi):** open that address in Safari or Chrome.
- **Away from home:** install **[Tailscale](https://tailscale.com/download)** on the server device
  and on the phone, sign in with the same account, then open `http://<server-device-name>:8080`.
  The server stays closed to everyone else.

Then make it an app:
- **iPhone (Safari):** Share → **Add to Home Screen**.
- **Android (Chrome):** ⋮ menu → **Add to Home screen**.

## 4. Using the GitHub link

While the server runs, **https://mahendradharma.github.io/ProjectMusic/** on the same device
connects to it automatically and shows YouTube Music. Without the server it falls back to indie
music from Audius.

- Use **Chrome, Edge or Firefox**. If asked to *allow access to devices on your local network*, choose **Allow**.
- **Safari** may block an HTTPS site from talking to `localhost`; use `http://localhost:8080` there.
- Change the server address in **Settings (slider icon) → Server address**.

## Troubleshooting

| Problem | Fix |
|---|---|
| Songs are listed but won't play | Stop the server and run the start script again: it updates `yt-dlp`, which usually fixes it. |
| "not a bot" message | The server is on a network YouTube blocks (VPN, hosting). Run it on home Wi-Fi or mobile data. |
| "not a bot" even at home | Export `cookies.txt` from a **spare** YouTube account (Netscape format, e.g. with a "Get cookies.txt LOCALLY" browser extension) and start the server with `PM_COOKIES=/path/to/cookies.txt`. `/api/health` then shows `"cookies": true`. YouTube may limit the account used, so never use your main one. |
| Some songs fail | Some songs are region- or age-restricted by YouTube; skip them. |
| Charts for another country | `PM_COUNTRY=US sh server/start.sh` |
| Port 8080 is taken | `sh server/start.sh --port 9090`, then open `http://localhost:9090`. |

Some `yt-dlp` YouTube features need a JavaScript runtime. If many songs fail, install
[Deno](https://deno.com) or Node.js on the server device and restart. `/api/health` shows
`"jsRuntime": true` once one is found.
