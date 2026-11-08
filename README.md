# ProjectMusic

A **free**, **lightweight**, **open-source** music player for the web — part of the
"Project" family of apps (alongside [Project-Fit](https://github.com/MahendraDharma/project-fit)).

It started from a simple frustration: music apps keep putting more behind a paywall, and they
keep getting heavier for older phones. ProjectMusic goes the other way — open it in a browser,
no account, no ads, nothing to install.

*Bahasa Indonesia: the app can be switched to Bahasa Indonesia in Settings, and the server
guide is available in [Indonesian](docs/PANDUAN-SERVER.md).*

## Two ways to use it

| | **Web mode** (GitHub Pages) | **Personal server mode** |
|---|---|---|
| How | Just open the link | Run the small server on your own laptop or Android phone |
| Catalogue | Indie music from [Audius](https://audius.org) | **YouTube Music**: charts, every popular artist |
| Lyrics, radio, downloads, share cards | — | ✅ |
| For | Anyone | **Personal use** |

👉 **Server guide:** [English](docs/SERVER-GUIDE.md) · [Bahasa Indonesia](docs/PANDUAN-SERVER.md)

## Features

- **Home** — quick picks, *Made for you*, your top artists, Indonesian charts, popular artists, *Because you played*
- **Search** — songs and artists, recent searches, browse tiles; artist and playlist pages
- **Smooth transitions** — the end of a song fades out while the next fades in (0–12 s, in Settings)
- **Taste-based recommendations** — learns, on your device, which artists you finish and which songs you skip;
  orders the autoplay radio and builds *Made for you*. Nothing is uploaded.
- **Synced lyrics** — full-screen on phones, side by side on desktop; tap a line to jump (from LRCLIB / YouTube Music)
- **Share to Instagram** — pick up to 5 lyric lines or the whole song, get a 9:16 Story card, send it via the share sheet
- **Mix** — blend two songs with a crossfader, per-deck volume, bass and treble
- Queue, shuffle, repeat, sleep timer, liked songs, history, downloads
- **Local files** — pick or drag & drop MP3s; they never leave the device
- **Lock-screen controls** and background playback (Media Session API)
- **Installable** as an app (PWA) on Android, iPhone, Mac and Windows
- **Phone and desktop layouts** — tab bar + mini player on phones; sidebar, queue/lyrics panel and a floating player bar from 1024 px
- **Light on old phones** — no framework, no build step, translucent bars switch off automatically on weak devices

## Run it on your computer

Web mode only (no YouTube Music):

```bash
python3 -m http.server 8080 -d public
```

With the personal server (YouTube Music, lyrics, share cards) — see the
[server guide](docs/SERVER-GUIDE.md):

- **Windows:** double-click `server/start.bat`
- **Mac:** `sh server/start.sh` (or double-click `server/start.command`)
- **Linux:** `sh server/install-linux.sh` adds ProjectMusic to your app menu
  (`--autostart` starts it at every login, `--uninstall` removes it)
- **Android:** run `server/start.sh` in Termux

Then open <http://localhost:8080>.

## Deploy for free (GitHub Pages)

1. **Settings → Pages → Source: GitHub Actions**.
2. Every push to `main` is deployed by [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml).

## Code layout

```
public/
├── index.html              # app shell
├── css/style.css           # design tokens + phone & desktop layouts
├── fonts/                  # DM Sans (SIL Open Font License)
├── js/
│   ├── app.js              # routing, pages, Now Playing, lyrics, share flow, settings
│   ├── player.js           # playback engine: queue, shuffle, repeat, crossfade, Media Session
│   ├── taste.js            # on-device taste model (artist scores, skips, ranking)
│   ├── share.js            # Instagram Story cards drawn on <canvas>
│   ├── mix.js              # two-deck mixer (Web Audio API, loaded on demand)
│   ├── i18n.js             # English (default) and Bahasa Indonesia
│   ├── store.js            # liked songs, history, settings (localStorage)
│   ├── ui.js               # DOM helper, icons, sheet, toast, skeletons
│   └── sources/            # audius.js · ytmusic.js · local.js
├── sw.js                   # service worker (installable, fast start)
└── manifest.webmanifest
server/
├── projectmusic_server.py  # personal server: catalogue (ytmusicapi) + audio (yt-dlp)
├── start.sh / start.bat / start.command
└── install-linux.sh / linux-launch.sh   # Linux app-menu entry + optional autostart
docs/
├── SERVER-GUIDE.md · PANDUAN-SERVER.md
├── desain/                 # design mockups
└── logo-pilihan/           # logo concepts
```

## Credits

Inspired by [BitChord](https://github.com/kushagrasinghx/BitChord) and [ytify](https://github.com/n-ce/ytify).
Uses [ytmusicapi](https://github.com/sigma67/ytmusicapi), [yt-dlp](https://github.com/yt-dlp/yt-dlp),
[LRCLIB](https://lrclib.net), [Audius](https://audius.org) and the [DM Sans](https://fonts.google.com/specimen/DM+Sans) typeface.

ProjectMusic is not affiliated with YouTube, Google, Instagram or Audius. Personal server mode
accesses YouTube unofficially; using it is subject to YouTube's Terms of Service and is each
user's own responsibility. Lyrics are fetched while a song plays and are never stored in this repository.

## License & governance

Code released under the [MIT License](LICENSE) © MahendraDharma.
The project has a single maintainer — see [CONTRIBUTING.md](CONTRIBUTING.md).
