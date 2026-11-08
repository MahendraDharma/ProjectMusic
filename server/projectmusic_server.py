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
import http.client
import json
import mimetypes
import os
import re
import shutil
import socket
import ssl
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

VERSION = "0.4.0"
ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
COUNTRY = os.environ.get("PM_COUNTRY", "ID")  # kode negara untuk tangga lagu
USER_AGENT = "ProjectMusic/" + VERSION

# Situs yang boleh memakai server ini dari browser (CORS). Hanya tampilan ProjectMusic
# di GitHub Pages milik Anda + localhost; situs lain ditolak supaya server tidak
# disalahgunakan. Tambah alamat lain lewat PM_ALLOWED_ORIGINS (pisahkan dengan koma).
ALLOWED_ORIGINS = {"https://mahendradharma.github.io"} | {
    o.strip().rstrip("/") for o in os.environ.get("PM_ALLOWED_ORIGINS", "").split(",") if o.strip()
}
LOCAL_ORIGIN = re.compile(r"^https?://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$")


def origin_allowed(origin: str | None) -> bool:
    return bool(origin) and (origin in ALLOWED_ORIGINS or bool(LOCAL_ORIGIN.match(origin)))

# Python dari python.org di Mac tidak memakai sertifikat sistem, sehingga HTTPS bisa
# gagal (CERTIFICATE_VERIFY_FAILED). Pakai paket certifi (ikut terpasang bersama yt-dlp).
try:
    import certifi

    SSL_CONTEXT = ssl.create_default_context(cafile=certifi.where())
except ImportError:  # pragma: no cover
    SSL_CONTEXT = ssl.create_default_context()
_opener = urllib.request.build_opener(urllib.request.HTTPSHandler(context=SSL_CONTEXT))


def urlopen(req, timeout):
    return _opener.open(req, timeout=timeout)


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


_NOISE = re.compile(
    r"\s*[\(\[][^)\]]*(official|lyric|lirik|video|audio|live|mv|visualizer|music video)[^)\]]*[\)\]]",
    re.I,
)


_CHANNEL_SUFFIX = re.compile(
    r"(\s*[-\u2013]?\s*\b(official|music|tv|channel|vevo|topic|records|band)\b)+\s*$", re.I
)


def clean_title(title: str, artist: str) -> str:
    """Rapikan judul gaya YouTube: buang "(Official Video)", nama artis di depan/belakang,
    dan ubah judul HURUF BESAR SEMUA menjadi Title Case."""
    t = _NOISE.sub("", title or "").strip()
    first = (artist or "").split(",")[0].strip().lower()
    # Nama kanal sering diberi akhiran: "Jeyma Monica Official", "NOAH Music", "XYZ - Topic".
    first = _CHANNEL_SUFFIX.sub("", first).strip() or first
    m = re.match(r"^(.+?)\s+[-\u2013\u2014|]\s+(.+)$", t)
    if m and first:
        left, right = m.group(1).strip(), m.group(2).strip()
        if first in left.lower():
            t = right
        elif first in right.lower():
            t = left
    t = t.strip(" -|")
    if len(t) > 4 and t.upper() == t and any(c.isalpha() for c in t):
        t = t.title()
    return t or (title or "")


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
        "title": clean_title(item.get("title") or "", artist) or "Untitled",
        "rawTitle": item.get("title") or "",
        "artist": artist or "Unknown artist",
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
                with urlopen(req, timeout=8) as r:
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


def api_prepare(q):
    """Look up the audio link of an upcoming song in the background, so it starts
    instantly when its turn comes (yt-dlp needs a few seconds per song)."""
    vid = (q.get("id") or [""])[0]
    if VIDEO_ID.match(vid) and cache.get("audio:" + vid) is None:
        threading.Thread(target=lambda: _quiet(resolve_audio, vid), daemon=True).start()
    return {"ok": True}


def _quiet(fn, *args):
    try:
        fn(*args)
    except Exception:
        pass


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
    "/api/prepare": api_prepare,
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
        "size": int(fmt.get("filesize") or 0),  # total bytes; looked up on first request if missing
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

    def end_headers(self):
        # Izinkan tampilan ProjectMusic di GitHub Pages memanggil server ini.
        origin = self.headers.get("Origin")
        if origin_allowed(origin):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Private-Network", "true")
            self.send_header("Vary", "Origin")
        super().end_headers()

    def do_OPTIONS(self):
        # Pemeriksaan awal browser sebelum situs HTTPS memanggil server di jaringan lokal.
        if not origin_allowed(self.headers.get("Origin")):
            self.send_response(403)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        self.send_response(204)
        self.send_header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Range")
        self.send_header("Access-Control-Max-Age", "600")
        self.send_header("Content-Length", "0")
        self.end_headers()

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
            if path == "/api/image":
                return self._image(query)
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

    # ---- gambar sampul (untuk kartu share di <canvas>) ------------------- #
    def _image(self, query):
        url = (query.get("url") or [""])[0]
        host = urllib.parse.urlparse(url).hostname or ""
        if not url.startswith("https://") or not (
            host == "i.ytimg.com" or host.endswith(".googleusercontent.com") or host.endswith(".ggpht.com")
        ):
            raise ValueError("Alamat gambar tidak diizinkan")
        cached_img = cache.get("img:" + url)
        if cached_img is None:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urlopen(req, timeout=10) as r:
                cached_img = (r.headers.get("Content-Type") or "image/jpeg", r.read(3_000_000))
            cache.set("img:" + url, cached_img, 3600)
        ctype, data = cached_img
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "public, max-age=86400")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

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
        """Send the audio to the browser.

        YouTube throttles big open-ended downloads, which made playback stutter and
        seeking slow. So the requested range is fetched from YouTube in small pieces
        (512 KB first for a fast start/seek, then 4 MB) over ONE reused connection,
        and passed on as a single, exact HTTP response."""
        vid = (query.get("id") or [""])[0]
        if not VIDEO_ID.match(vid):
            raise ValueError("id lagu tidak valid")
        download = (query.get("download") or ["0"])[0] == "1"

        info = resolve_audio(vid)
        up = Upstream(info)
        try:
            total = up.total_size()
        except UpstreamExpired:
            cache.drop("audio:" + vid)
            info = resolve_audio(vid, fresh=True)
            up = Upstream(info)
            total = up.total_size()

        start, end, partial = 0, total - 1, False
        rng = self.headers.get("Range", "")
        m = re.match(r"bytes=(\d*)-(\d*)$", rng.strip())
        if m and (m.group(1) or m.group(2)):
            partial = True
            if m.group(1):
                start = int(m.group(1))
                end = min(int(m.group(2)), total - 1) if m.group(2) else total - 1
            else:  # suffix range: last N bytes
                start = max(0, total - int(m.group(2)))
        if start >= total or start > end:
            self.send_response(416)
            self.send_header("Content-Range", f"bytes */{total}")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return

        self.send_response(206 if partial else 200)
        self.send_header("Content-Type", up.content_type)
        self.send_header("Content-Length", str(end - start + 1))
        if partial:
            self.send_header("Content-Range", f"bytes {start}-{end}/{total}")
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Cache-Control", "no-store")
        if download:
            safe = re.sub(r'[\\/:*?"<>|]+', " ", info["title"]).strip()[:120] or vid
            fname = f"{safe}.{info['ext']}"
            self.send_header("Content-Disposition", "attachment; filename*=UTF-8''" + urllib.parse.quote(fname))
        self.end_headers()
        if self.command == "HEAD":
            up.close()
            return
        try:
            pos = start
            chunk = FIRST_CHUNK
            renewed = False
            while pos <= end:
                stop = min(pos + chunk - 1, end)
                try:
                    for data in up.read_range(pos, stop):
                        self.wfile.write(data)
                        pos += len(data)
                except UpstreamExpired:
                    if renewed:
                        raise
                    # The link expired mid-song: get a fresh one and carry on from `pos`.
                    renewed = True
                    up.close()
                    cache.drop("audio:" + vid)
                    up = Upstream(resolve_audio(vid, fresh=True))
                    continue
                chunk = CHUNK
        finally:
            up.close()


FIRST_CHUNK = 512 * 1024
CHUNK = 4 * 1024 * 1024


class UpstreamExpired(Exception):
    """The YouTube audio URL is no longer valid (403/410)."""


class Upstream:
    """One reusable connection to the audio host, fetching byte ranges."""

    def __init__(self, info: dict):
        self.info = info
        u = urllib.parse.urlsplit(info["url"])
        self.https = u.scheme == "https"
        self.host = u.netloc
        self.path = u.path + ("?" + u.query if u.query else "")
        self.conn = None
        self.content_type = "audio/mp4" if info["ext"] == "m4a" else "audio/webm"

    def _connect(self):
        if self.conn is None:
            if self.https:
                self.conn = http.client.HTTPSConnection(self.host, timeout=20, context=SSL_CONTEXT)
            else:
                self.conn = http.client.HTTPConnection(self.host, timeout=20)
        return self.conn

    def _request(self, first: int, last: int):
        headers = dict(self.info["headers"])
        headers["Range"] = f"bytes={first}-{last}"
        for attempt in range(3):
            try:
                conn = self._connect()
                conn.request("GET", self.path, headers=headers)
                resp = conn.getresponse()
            except (http.client.HTTPException, OSError):
                self.close()  # stale keep-alive connection: reconnect
                if attempt == 2:
                    raise
                continue
            if resp.status in (403, 410):
                resp.read()
                raise UpstreamExpired()
            if resp.status not in (200, 206):
                resp.read()
                raise RuntimeError(f"audio host answered {resp.status}")
            ctype = resp.getheader("Content-Type") or ""
            if ctype:
                self.content_type = ("audio/" + ctype.split("/", 1)[1]) if ctype.startswith("video/") else ctype
            return resp
        raise RuntimeError("audio host unreachable")

    def total_size(self) -> int:
        if self.info.get("size"):
            return self.info["size"]
        resp = self._request(0, 0)
        resp.read()
        cr = resp.getheader("Content-Range") or ""
        m = re.search(r"/(\d+)$", cr)
        size = int(m.group(1)) if m else int(resp.getheader("Content-Length") or 0)
        if not size:
            raise RuntimeError("unknown audio size")
        self.info["size"] = size
        return size

    def read_range(self, first: int, last: int):
        resp = self._request(first, last)
        while True:
            # read1: pass on whatever has arrived instead of waiting for a full block
            data = resp.read1(64 * 1024)
            if not data:
                break
            yield data

    def close(self):
        if self.conn is not None:
            try:
                self.conn.close()
            except Exception:
                pass
            self.conn = None


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
