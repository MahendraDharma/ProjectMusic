#!/usr/bin/env python3
"""
ProjectMusic — server mini untuk pemakaian PRIBADI.

Jalankan di perangkat Anda sendiri (laptop/PC atau HP Android lewat Termux).
Server ini:
  * menyajikan tampilan web ProjectMusic (folder ../public),
  * mengambil katalog YouTube Music (pencarian, tangga lagu, playlist, radio, lirik)
    lewat library `ytmusicapi`,
  * mengambil audio lewat `yt-dlp` lalu meneruskannya ke browser (mendukung seek).

Sengaja hanya memakai pustaka standar Python + 2 library murni Python, supaya
bisa jalan di perangkat lama tanpa perlu kompilasi apa pun.

Pemakaian:  python projectmusic_server.py [--host 0.0.0.0] [--port 8080]
"""
from __future__ import annotations

import argparse
import json
import mimetypes
import os
import re
import shutil
import socket
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

try:
    from ytmusicapi import YTMusic
    import yt_dlp
except ImportError:  # pragma: no cover - pesan ramah untuk pengguna
    sys.exit(
        "Library belum terpasang. Jalankan skrip start (start.sh / start.bat), "
        "atau: pip install -r requirements.txt"
    )

VERSION = "0.2.0"
ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
COUNTRY = os.environ.get("PM_COUNTRY", "ID")  # kode negara untuk tangga lagu
USER_AGENT = "ProjectMusic/" + VERSION

mimetypes.add_type("application/manifest+json", ".webmanifest")
mimetypes.add_type("text/javascript", ".js")


# --------------------------------------------------------------------------- #
# Cache sederhana di memori (data katalog tidak perlu diambil ulang tiap saat)
# --------------------------------------------------------------------------- #
class TTLCache:
    def __init__(self, max_items: int = 500):
        self._data: dict = {}
        self._lock = threading.Lock()
        self._max = max_items

    def get(self, key):
        with self._lock:
            item = self._data.get(key)
            if not item:
                return None
            value, expires = item
            if expires < time.time():
                self._data.pop(key, None)
                return None
            return value

    def set(self, key, value, ttl: float):
        with self._lock:
            if len(self._data) >= self._max:
                # buang yang paling lama kedaluwarsa
                oldest = min(self._data, key=lambda k: self._data[k][1])
                self._data.pop(oldest, None)
            self._data[key] = (value, time.time() + ttl)

    def drop(self, key):
        with self._lock:
            self._data.pop(key, None)


cache = TTLCache()
_local = threading.local()


def ytm() -> YTMusic:
    """Satu klien YTMusic per thread (klien memakai session HTTP yang tidak thread-safe)."""
    if not hasattr(_local, "ytm"):
        _local.ytm = YTMusic(location=COUNTRY)
    return _local.ytm


def cached(key: str, ttl: float, fn):
    value = cache.get(key)
    if value is None:
        value = fn()
        cache.set(key, value, ttl)
    return value


# --------------------------------------------------------------------------- #
# Normalisasi data → bentuk "track" yang sama dengan sumber lain di aplikasi web
# --------------------------------------------------------------------------- #
def _seconds(text) -> int:
    if not text or not isinstance(text, str):
        return 0
    total = 0
    for part in text.split(":"):
        if not part.isdigit():
            return 0
        total = total * 60 + int(part)
    return total


def _art(thumbs, size: int) -> str:
    if not thumbs:
        return ""
    url = thumbs[-1].get("url", "")
    # Gambar googleusercontent bisa diminta dalam ukuran berapa pun.
    url = re.sub(r"=w\d+-h\d+", f"=w{size}-h{size}", url)
    return url


def track(item: dict) -> dict | None:
    vid = item.get("videoId")
    if not vid:
        return None
    artists = item.get("artists") or []
    artist = ", ".join(a.get("name", "") for a in artists if a.get("name")) or item.get("author") or ""
    thumbs = item.get("thumbnails") or item.get("thumbnail") or []
    duration = item.get("duration_seconds") or _seconds(item.get("duration") or item.get("length"))
    album = item.get("album") or {}
    return {
        "id": "yt:" + vid,
        "videoId": vid,
        "source": "ytmusic",
        "title": item.get("title") or "Tanpa judul",
        "artist": artist or "Tidak diketahui",
        "album": album.get("name") if isinstance(album, dict) else None,
        "artwork": _art(thumbs, 120),
        "artworkLarge": _art(thumbs, 544),
        "duration": int(duration or 0),
        "streamUrl": "api/stream?id=" + urllib.parse.quote(vid),
        "link": "https://music.youtube.com/watch?v=" + vid,
    }


def tracks(items) -> list:
    out, seen = [], set()
    for it in items or []:
        t = track(it)
        if t and t["videoId"] not in seen:
            seen.add(t["videoId"])
            out.append(t)
    return out


# --------------------------------------------------------------------------- #
# Endpoint katalog
# --------------------------------------------------------------------------- #
def api_home(_q):
    def load():
        charts = ytm().get_charts(COUNTRY)
        sections = []
        for chart in (charts.get("videos") or [])[:3]:
            pid = chart.get("playlistId")
            if not pid:
                continue
            try:
                pl = ytm().get_playlist(pid, limit=50)
            except Exception:
                continue
            items = tracks(pl.get("tracks"))
            if items:
                sections.append({"title": chart.get("title") or "Tangga lagu", "playlistId": pid, "tracks": items})
        artists = []
        for a in (charts.get("artists") or [])[:20]:
            if a.get("browseId"):
                artists.append({
                    "id": a["browseId"],
                    "name": a.get("title") or "",
                    "artwork": _art(a.get("thumbnails"), 160),
                })
        return {"sections": sections, "artists": artists}

    return cached("home:" + COUNTRY, 30 * 60, load)


def api_search(q):
    query = (q.get("q") or [""])[0].strip()
    if not query:
        return {"tracks": [], "artists": []}

    def load():
        # Filter "songs" kadang kosong tanpa login, jadi gabungkan lagu + video.
        songs = []
        for f in ("songs", "videos"):
            try:
                songs += ytm().search(query, filter=f, limit=40)
            except Exception:
                pass
        try:
            found = ytm().search(query, filter="artists", limit=8)
        except Exception:
            found = []
        artists = [
            {"id": r["browseId"], "name": r.get("artist") or r.get("title") or "", "artwork": _art(r.get("thumbnails"), 160)}
            for r in found
            if r.get("browseId")
        ]
        return {"tracks": tracks(songs)[:50], "artists": artists[:8]}

    return cached("search:" + query.lower(), 10 * 60, load)


def api_playlist(q):
    pid = (q.get("id") or [""])[0]
    if not pid:
        raise ValueError("id wajib diisi")

    def load():
        pl = ytm().get_playlist(pid, limit=200)
        return {"title": pl.get("title"), "tracks": tracks(pl.get("tracks"))}

    return cached("pl:" + pid, 30 * 60, load)


def api_artist(q):
    aid = (q.get("id") or [""])[0]
    if not aid:
        raise ValueError("id wajib diisi")

    def load():
        a = ytm().get_artist(aid)
        songs = a.get("songs") or {}
        videos = a.get("videos") or {}
        items = list(songs.get("results") or [])
        # Coba ambil daftar yang lebih lengkap; tiap artis datanya berbeda-beda,
        # jadi pakai beberapa cadangan sampai dapat lagu.
        for pid in (songs.get("browseId"), videos.get("browseId")):
            if pid and len(items) < 20:
                try:
                    items += ytm().get_playlist(pid, limit=100).get("tracks") or []
                except Exception:
                    pass
        if len(items) < 20:
            items += videos.get("results") or []
        if len(items) < 20 and a.get("shuffleId"):
            try:
                items += ytm().get_watch_playlist(playlistId=a["shuffleId"], limit=50).get("tracks") or []
            except Exception:
                pass
        return {
            "name": a.get("name"),
            "artwork": _art(a.get("thumbnails"), 544),
            "tracks": tracks(items),
        }

    return cached("artist:" + aid, 60 * 60, load)


def api_next(q):
    """Lagu-lagu berikutnya ala 'radio' (seperti autoplay di YouTube Music)."""
    vid = (q.get("id") or [""])[0]
    if not vid:
        raise ValueError("id wajib diisi")

    def load():
        w = ytm().get_watch_playlist(videoId=vid, limit=30, radio=True)
        return {"tracks": [t for t in tracks(w.get("tracks")) if t["videoId"] != vid]}

    return cached("next:" + vid, 30 * 60, load)


def _lrc_lines(text: str):
    lines = []
    for raw in text.splitlines():
        m = re.match(r"\[(\d+):(\d+(?:\.\d+)?)\](.*)", raw)
        if m:
            lines.append({"t": int(m.group(1)) * 60 + float(m.group(2)), "text": m.group(3).strip()})
    return lines


def api_lyrics(q):
    """Lirik diambil saat itu juga dari YouTube Music, cadangan dari LRCLIB."""
    vid = (q.get("id") or [""])[0]
    title = (q.get("title") or [""])[0]
    artist = (q.get("artist") or [""])[0]
    duration = (q.get("duration") or [""])[0]

    def load():
        result = {"synced": None, "plain": None, "source": None}
        # 1) LRCLIB — sering punya lirik yang tersinkron dengan waktu
        if title and artist:
            params = {"track_name": title, "artist_name": artist.split(",")[0]}
            if duration.isdigit() and int(duration) > 0:
                params["duration"] = duration
            try:
                req = urllib.request.Request(
                    "https://lrclib.net/api/get?" + urllib.parse.urlencode(params),
                    headers={"User-Agent": USER_AGENT},
                )
                with urllib.request.urlopen(req, timeout=8) as r:
                    data = json.load(r)
                if data.get("syncedLyrics"):
                    result.update(synced=_lrc_lines(data["syncedLyrics"]), source="LRCLIB")
                    return result
                if data.get("plainLyrics"):
                    result.update(plain=data["plainLyrics"], source="LRCLIB")
            except Exception:
                pass
        # 2) YouTube Music
        if vid:
            try:
                browse = ytm().get_watch_playlist(videoId=vid, limit=1).get("lyrics")
                if browse:
                    lyr = ytm().get_lyrics(browse, timestamps=True) or {}
                    if lyr.get("hasTimestamps"):
                        result.update(
                            synced=[{"t": l.start_time / 1000, "text": l.text} for l in lyr.get("lyrics") or []],
                            plain=None,
                            source=lyr.get("source") or "YouTube Music",
                        )
                    elif lyr.get("lyrics") and not result["plain"]:
                        result.update(plain=lyr["lyrics"], source=lyr.get("source") or "YouTube Music")
            except Exception:
                pass
        return result

    return cached(f"lyrics:{vid}:{title}:{artist}", 6 * 3600, load)


def api_health(_q):
    return {
        "ok": True,
        "mode": "server",
        "version": VERSION,
        "country": COUNTRY,
        "ytdlp": yt_dlp.version.__version__,
        "jsRuntime": bool(shutil.which("deno") or shutil.which("node") or shutil.which("bun")),
    }


API = {
    "/api/health": api_health,
    "/api/home": api_home,
    "/api/search": api_search,
    "/api/playlist": api_playlist,
    "/api/artist": api_artist,
    "/api/next": api_next,
    "/api/lyrics": api_lyrics,
}


# --------------------------------------------------------------------------- #
# Audio: cari URL audio dengan yt-dlp, lalu teruskan ke browser
# --------------------------------------------------------------------------- #
VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
# m4a/AAC dulu karena Safari di iPhone tidak bisa memutar WebM/Opus.
AUDIO_FORMAT = "bestaudio[ext=m4a]/bestaudio[acodec^=mp4a]/bestaudio"


def resolve_audio(vid: str, fresh: bool = False) -> dict:
    key = "audio:" + vid
    if not fresh:
        hit = cache.get(key)
        if hit:
            return hit
    opts = {"format": AUDIO_FORMAT, "quiet": True, "no_warnings": True, "noplaylist": True, "skip_download": True}
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info("https://www.youtube.com/watch?v=" + vid, download=False)
    fmt = info
    if not info.get("url") and info.get("requested_formats"):
        fmt = info["requested_formats"][0]
    data = {
        "url": fmt["url"],
        "headers": fmt.get("http_headers") or info.get("http_headers") or {},
        "ext": fmt.get("ext") or "m4a",
        "title": info.get("title") or vid,
    }
    # URL audio YouTube berlaku ±6 jam; simpan sedikit lebih singkat.
    cache.set(key, data, 4 * 3600)
    return data


# --------------------------------------------------------------------------- #
# HTTP handler
# --------------------------------------------------------------------------- #
class Handler(BaseHTTPRequestHandler):
    server_version = "ProjectMusic/" + VERSION
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):  # log ringkas
        sys.stderr.write("[%s] %s\n" % (time.strftime("%H:%M:%S"), fmt % args))

    # ---- utilitas -------------------------------------------------------- #
    def _send_json(self, status: int, payload):
        body = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)
        try:
            if path == "/api/stream":
                return self._stream(query)
            if path in API:
                return self._send_json(200, API[path](query))
            if path.startswith("/api/"):
                return self._send_json(404, {"error": "Endpoint tidak dikenal"})
            return self._static(path)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except ValueError as e:
            self._send_json(400, {"error": str(e)})
        except Exception as e:  # jangan sampai server mati karena satu permintaan
            self.log_message("ERROR %s: %r", path, e)
            try:
                self._send_json(502, {"error": "Gagal mengambil data dari YouTube Music.", "detail": str(e)[:300]})
            except Exception:
                pass

    # ---- file statis (tampilan web) ------------------------------------- #
    def _static(self, path: str):
        rel = urllib.parse.unquote(path).lstrip("/") or "index.html"
        target = (PUBLIC / rel).resolve()
        if not str(target).startswith(str(PUBLIC.resolve())) or not target.is_file():
            target = PUBLIC / "index.html"  # aplikasi satu halaman
        data = target.read_bytes()
        ctype = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", ctype + ("; charset=utf-8" if ctype.startswith("text/") else ""))
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    # ---- audio ----------------------------------------------------------- #
    def _stream(self, query):
        vid = (query.get("id") or [""])[0]
        if not VIDEO_ID.match(vid):
            raise ValueError("id lagu tidak valid")
        download = (query.get("download") or ["0"])[0] == "1"

        upstream = None
        for attempt in range(2):
            info = resolve_audio(vid, fresh=attempt > 0)
            headers = dict(info["headers"])
            if self.headers.get("Range"):
                headers["Range"] = self.headers["Range"]
            req = urllib.request.Request(info["url"], headers=headers, method=self.command)
            try:
                upstream = urllib.request.urlopen(req, timeout=20)
                break
            except urllib.error.HTTPError as e:
                if e.code == 416:  # range di luar batas
                    self.send_response(416)
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    return
                if e.code in (403, 410) and attempt == 0:
                    cache.drop("audio:" + vid)  # URL kedaluwarsa → ambil ulang
                    continue
                raise

        with upstream:
            self.send_response(upstream.status)
            ctype = upstream.headers.get("Content-Type") or ("audio/mp4" if info["ext"] == "m4a" else "audio/webm")
            if ctype.startswith("video/"):
                ctype = "audio/" + ctype.split("/", 1)[1]
            self.send_header("Content-Type", ctype)
            for h in ("Content-Length", "Content-Range"):
                if upstream.headers.get(h):
                    self.send_header(h, upstream.headers[h])
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Cache-Control", "no-store")
            if download:
                safe = re.sub(r'[\\/:*?"<>|]+', " ", info["title"]).strip()[:120] or vid
                fname = f"{safe}.{info['ext']}"
                self.send_header(
                    "Content-Disposition",
                    "attachment; filename*=UTF-8''" + urllib.parse.quote(fname),
                )
            self.end_headers()
            if self.command == "HEAD":
                return
            while True:
                chunk = upstream.read(64 * 1024)
                if not chunk:
                    break
                self.wfile.write(chunk)


# --------------------------------------------------------------------------- #
def local_addresses() -> list[str]:
    addrs = set()
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))
        addrs.add(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    return sorted(a for a in addrs if not a.startswith("127."))


def main():
    ap = argparse.ArgumentParser(description="Server pribadi ProjectMusic")
    ap.add_argument("--host", default=os.environ.get("PM_HOST", "0.0.0.0"))
    ap.add_argument("--port", type=int, default=int(os.environ.get("PM_PORT", "8080")))
    args = ap.parse_args()

    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    httpd.daemon_threads = True
    print("=" * 56)
    print(" ProjectMusic server " + VERSION + " sudah jalan!")
    print(f"  • Di perangkat ini : http://localhost:{args.port}")
    for ip in local_addresses():
        print(f"  • Dari HP lain (Wi-Fi sama): http://{ip}:{args.port}")
    print("  Tekan Ctrl+C untuk berhenti.")
    print("=" * 56)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nServer dihentikan.")


if __name__ == "__main__":
    main()
