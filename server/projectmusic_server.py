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

VERSION = "0.5.2"
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


def _fast_refused():
    """A fast-path link was refused by the audio host: count it like a failed lookup."""
    _fast["misses"] += 1
    if _fast["misses"] >= 3:
        _fast.update(misses=0, off_until=time.time() + 1800)
        _log("audio: fast lookup links are refused right now, using the full one for 30 min")


def open_audio(vid: str):
    """(info, upstream, total size) for a song, renewing an expired or refused link once."""
    info = resolve_audio(vid)
    up = Upstream(info)
    try:
        return info, up, up.total_size()
    except UpstreamExpired:
        up.close()
        cache.drop("audio:" + vid)
        if info.get("path") == "fast":
            _fast_refused()
        info = resolve_audio(vid, fresh=True, full=info.get("path") == "fast")
        up = Upstream(info)
        return info, up, up.total_size()


_prepare_slots = threading.BoundedSemaphore(3)


def _prepare(vid: str):
    try:
        _, up, _ = open_audio(vid)  # also learns the file size and warms a connection
        up.close()
    finally:
        _prepare_slots.release()


def api_prepare(q):
    """Look up the audio link of a song the person is likely to play next (the next
    song in the queue, or one they are touching / hovering), so it starts right away.
    yt-dlp needs a few seconds per song. At most 3 lookups run at once, so scrolling
    through a list can't flood YouTube."""
    vid = (q.get("id") or [""])[0]
    hit = cache.get("audio:" + vid) if VIDEO_ID.match(vid) else True
    if not hit or (isinstance(hit, dict) and not hit.get("size")):
        if not _prepare_slots.acquire(blocking=False):
            return {"ok": True, "queued": False}  # busy: the app may ask again later
        threading.Thread(target=lambda: _quiet(_prepare, vid), daemon=True).start()
    return {"ok": True, "queued": True}


# --------------------------------------------------------------------------- #
# Import playlist dari platform lain. Hanya daftar lagu (judul, artis, durasi) dari
# halaman publik yang dibaca; audio tetap diputar dari YouTube Music lewat pencocokan.
# --------------------------------------------------------------------------- #
IMPORT_HOSTS = {
    "open.spotify.com", "spotify.link", "spotify.app.link",
    "music.apple.com", "itunes.apple.com", "embed.music.apple.com",
    "www.deezer.com", "deezer.com", "link.deezer.com", "deezer.page.link", "dzr.page.link",
    "music.youtube.com", "www.youtube.com", "youtube.com", "m.youtube.com", "youtu.be",
}
BROWSER_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/130.0 Safari/537.36"
)
IMPORT_MAX = 1000


def _host_ok(url: str) -> bool:
    p = urllib.parse.urlparse(url)
    return p.scheme in ("http", "https") and (p.hostname or "").lower() in IMPORT_HOSTS


def _fetch(url: str, *, data_host: str | None = None) -> tuple[str, str]:
    """Ambil halaman publik. Pengalihan (tautan pendek) hanya boleh ke host yang dikenal."""
    if not (_host_ok(url) or (data_host and urllib.parse.urlparse(url).hostname == data_host)):
        raise ValueError("This link is not supported.")
    req = urllib.request.Request(url, headers={"User-Agent": BROWSER_UA, "Accept-Language": "en-US,en;q=0.8"})
    try:
        with urlopen(req, timeout=15) as r:
            final = r.geturl()
            if not (_host_ok(final) or (data_host and urllib.parse.urlparse(final).hostname == data_host)):
                raise ValueError("This link is not supported.")
            return final, r.read(8_000_000).decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        if e.code in (401, 403, 404):
            raise ValueError("Playlist not found. Make sure it is public.") from None
        raise


def _ms(v) -> int:
    try:
        return int(round(float(v) / 1000))
    except (TypeError, ValueError):
        return 0


def _https(url) -> str:
    return url if isinstance(url, str) and url.startswith("https://") else ""


def _import_youtube(url: str) -> dict:
    p = urllib.parse.urlparse(url)
    qs = urllib.parse.parse_qs(p.query)
    pid = (qs.get("list") or [""])[0]
    if p.path.startswith("/browse/MPRE"):
        album = ytm().get_album(p.path.split("/")[2])
        items = album.get("tracks") or []
        for it in items:  # lagu album tidak membawa sampul sendiri
            it.setdefault("thumbnails", album.get("thumbnails"))
        return {"name": album.get("title") or "Album", "cover": _art(album.get("thumbnails"), 544),
                "tracks": tracks(items), "matched": True}
    if not pid:
        raise ValueError("This YouTube link has no playlist in it (look for “list=” in the link).")
    if pid in ("LM", "LL", "WL"):
        raise ValueError("Private lists like Liked Music can’t be read. Make a public copy first.")
    try:
        pl = ytm().get_playlist(pid, limit=IMPORT_MAX)
    except Exception:
        raise ValueError("Playlist not found. Make sure it is public or unlisted.") from None
    found = tracks(pl.get("tracks"))
    return {"name": pl.get("title") or "YouTube playlist", "cover": _art(pl.get("thumbnails"), 544),
            "tracks": found, "matched": True}


def _import_spotify(url: str) -> dict:
    if (urllib.parse.urlparse(url).hostname or "").endswith(".link"):
        url, _ = _fetch(url)  # tautan pendek -> open.spotify.com/...
    parts = [s for s in urllib.parse.urlparse(url).path.split("/") if s and not s.startswith("intl-")]
    kinds = ("playlist", "album", "track", "artist")
    if len(parts) < 2 or parts[0] not in kinds:
        raise ValueError("Use a Spotify playlist, album or song link.")
    kind, sid = parts[0], parts[1]
    if not re.match(r"^[A-Za-z0-9]{10,32}$", sid):
        raise ValueError("This Spotify link looks incomplete.")
    _, html = _fetch(f"https://open.spotify.com/embed/{kind}/{sid}")
    m = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', html, re.S)
    if not m:
        raise ValueError("Spotify didn’t return this playlist. Make sure it is public.")
    ent = (((json.loads(m.group(1)).get("props") or {}).get("pageProps") or {}).get("state") or {}).get("data", {}).get("entity") or {}
    cover = ""
    for src in ((ent.get("coverArt") or {}).get("sources") or ent.get("visualIdentity", {}).get("image") or []):
        if isinstance(src, dict) and src.get("url"):
            cover = _https(src["url"])
            break
    items = ent.get("trackList") or []
    if kind == "track" and not items:
        items = [{"title": ent.get("title") or ent.get("name"), "subtitle": ", ".join(a.get("name", "") for a in ent.get("artists") or []),
                  "duration": ent.get("duration")}]
    out = []
    for it in items[:IMPORT_MAX]:
        title = (it.get("title") or "").strip()
        if title:
            out.append({"title": title, "artist": re.sub(r"\s*,\s*", ", ", (it.get("subtitle") or "").replace(" ", " ")).strip(),
                        "duration": _ms(it.get("duration"))})
    return {"name": ent.get("name") or ent.get("title") or "Spotify", "cover": cover, "tracks": out}


def _import_apple(url: str) -> dict:
    p = urllib.parse.urlparse(url)
    if not re.search(r"/(playlist|album|song)/", p.path):
        raise ValueError("Use an Apple Music playlist or album link.")
    _, html = _fetch(urllib.parse.urlunparse(p._replace(netloc="music.apple.com", fragment="")))
    name, cover, out = "", "", []
    m = re.search(r'<script[^>]*id="serialized-server-data"[^>]*>(.*?)</script>', html, re.S)
    if m:
        try:
            data = json.loads(m.group(1))
            page = data["data"][0]["data"] if isinstance(data, dict) else data[0]["data"]
            album_artist = ""
            for sec in page.get("sections") or []:
                kind = sec.get("itemKind") or ""
                for it in sec.get("items") or []:
                    if kind == "containerDetailHeaderLockup":
                        name = name or it.get("title") or ""
                        album_artist = ", ".join(x.get("title", "") for x in it.get("subtitleLinks") or []) or album_artist
                        art = (it.get("artwork") or {}).get("dictionary") or {}
                        if art.get("url"):
                            cover = _https(art["url"].replace("{w}", "544").replace("{h}", "544").replace("{f}", "jpg"))
                    elif kind == "trackLockup" and it.get("title"):
                        artist = it.get("artistName") or ", ".join(x.get("title", "") for x in it.get("subtitleLinks") or [])
                        out.append({"title": it["title"], "artist": artist or album_artist, "duration": _ms(it.get("duration"))})
        except (KeyError, IndexError, TypeError, ValueError):
            out = []
    if not out:  # cadangan: data schema.org di halaman
        for blob in re.findall(r'<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>', html, re.S):
            try:
                j = json.loads(blob)
            except ValueError:
                continue
            name = name or j.get("name") or ""
            by = j.get("byArtist") or {}
            fallback_artist = by.get("name", "") if isinstance(by, dict) else ", ".join(a.get("name", "") for a in by)
            for tr in j.get("track") or []:
                d = re.match(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", tr.get("duration") or "")
                secs = (int(d.group(1) or 0) * 3600 + int(d.group(2) or 0) * 60 + int(d.group(3) or 0)) if d else 0
                out.append({"title": tr.get("name") or "", "artist": fallback_artist, "duration": secs})
    out = [t for t in out if t["title"]][:IMPORT_MAX]
    if not out:
        raise ValueError("Apple Music didn’t return any songs. Make sure the playlist is public.")
    return {"name": name or "Apple Music", "cover": cover, "tracks": out}


def _import_deezer(url: str) -> dict:
    host = urllib.parse.urlparse(url).hostname or ""
    if host != "www.deezer.com" and host != "deezer.com":
        url, _ = _fetch(url)  # tautan pendek
    m = re.search(r"/(playlist|album|track)/(\d+)", urllib.parse.urlparse(url).path)
    if not m:
        raise ValueError("Use a Deezer playlist or album link.")
    kind, did = m.groups()
    api = "api.deezer.com"
    _, raw = _fetch(f"https://{api}/{kind}/{did}", data_host=api)
    info = json.loads(raw)
    if info.get("error"):
        raise ValueError("Playlist not found. Make sure it is public.")
    if kind == "track":
        rows = [info]
    else:
        rows, nxt = [], f"https://{api}/{kind}/{did}/tracks?limit=100"
        while nxt and len(rows) < IMPORT_MAX:
            _, raw = _fetch(nxt, data_host=api)
            page = json.loads(raw)
            rows += page.get("data") or []
            nxt = page.get("next")
    out = [{"title": r.get("title") or "", "artist": (r.get("artist") or {}).get("name", ""), "duration": int(r.get("duration") or 0)}
           for r in rows if r.get("title")]
    return {"name": info.get("title") or "Deezer", "cover": _https(info.get("picture_big") or info.get("cover_big") or ""),
            "tracks": out[:IMPORT_MAX]}


def api_import(q):
    url = (q.get("url") or [""])[0].strip()
    if not url:
        raise ValueError("Paste a playlist link first.")
    if not re.match(r"^https?://", url, re.I):
        url = "https://" + url
    host = (urllib.parse.urlparse(url).hostname or "").lower()
    if host not in IMPORT_HOSTS:
        raise ValueError("This link isn’t supported yet. Try YouTube Music, Spotify, Apple Music or Deezer.")
    if "spotify" in host:
        source, fn = "spotify", _import_spotify
    elif "apple.com" in host:
        source, fn = "apple", _import_apple
    elif "deezer" in host or host.endswith(".page.link"):
        source, fn = "deezer", _import_deezer
    else:
        source, fn = "youtube", _import_youtube
    result = cached("import:" + url, 10 * 60, lambda: fn(url))
    if not result["tracks"]:
        raise ValueError("This playlist looks empty.")
    return {"source": source, "matched": False, **result}


# ---- pencocokan lagu ke YouTube Music ---------------------------------------- #
_EXTRA = re.compile(
    r"\s*([\(\[][^)\]]*[\)\]]|\s-\s.*(remaster|version|edit|mix|live|mono|stereo|from|feat|bonus|deluxe|acoustic).*$)", re.I
)


def _norm(s: str) -> str:
    import unicodedata

    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode() or (s or "")
    s = re.sub(r"\b(feat|ft|featuring)\.?\b.*$", "", s.lower())
    s = re.sub(r"[^\w\s]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def _artists(s: str) -> list[str]:
    return [a for a in (_norm(x) for x in re.split(r",|&| x | and |;|/|\bfeat\.?|\bft\.?", s or "", flags=re.I)) if a]


def _sim(a: str, b: str) -> float:
    from difflib import SequenceMatcher

    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    ratio = SequenceMatcher(None, a, b).ratio()
    if (a in b or b in a) and min(len(a), len(b)) >= 3:
        # "judul" di dalam "judul (versi panjang)" mirip, tapi makin panjang sisanya makin ragu
        return max(ratio, 0.6 + 0.35 * min(len(a), len(b)) / max(len(a), len(b)))
    return ratio


_VERSION_WORDS = re.compile(
    r"\b(remix|live|acoustic|sped ?up|slowed|reverb|nightcore|instrumental|karaoke|cover|8d|lounge|session|"
    r"demo|extended|radio edit|mashup|piano|lofi|lo-fi|bass ?boosted)\b", re.I
)


_NUMERAL = re.compile(r"^(\d+|ii|iii|iv|vi|vii|viii|ix)$")


def _numbers(s: str) -> set:
    return {w for w in s.split() if _NUMERAL.match(w)}


def _match_score(title: str, artist: str, duration: int, cand: dict) -> float:
    want = _norm(_EXTRA.sub("", title)) or _norm(title)
    raw_title = cand.get("rawTitle") or cand.get("title") or ""
    names = [_norm(_EXTRA.sub("", raw_title)), _norm(_EXTRA.sub("", cand.get("title") or "")), _norm(cand.get("title") or "")]
    wa, ca = _artists(artist), _artists(cand.get("artist") or "")
    raw = _norm(raw_title)
    for w in wa:  # unggahan "Artis - Judul": buang nama artis dari judulnya
        if w and w in names[0]:
            names.append(re.sub(r"\s+", " ", names[0].replace(w, " ")).strip())
    t_score = max(_sim(want, n) for n in names)
    if not wa:
        a_score = 0.6
    else:
        a_score = max((_sim(w, c) for w in wa for c in ca), default=0.0)
        if any(w and w in raw for w in wa):  # unggahan orang lain: "Artis - Judul (Lyrics)"
            a_score = max(a_score, 0.7)
    d_score, penalty = 0.85, 0.0  # durasi tidak diketahui: netral
    if duration and cand.get("duration"):
        diff = abs(duration - cand["duration"])
        d_score = 1.0 if diff <= 3 else max(0.0, 1 - (diff - 3) / 40)
        if diff > 30:
            penalty += 0.2  # hampir pasti versi lain (potongan, live, extended)
    # Versi lain (remix, live, sped up, ...) yang tidak diminta.
    asked = {w.lower() for w in _VERSION_WORDS.findall(title)}
    got = {w.lower() for w in _VERSION_WORDS.findall(raw_title)}
    if got - asked:
        penalty += 0.15
    # "Storm II" bukan "Storm I", "Part 2" bukan "Part 3"
    best_name = max(names, key=lambda n: _sim(want, n))
    if _numbers(want) != _numbers(best_name):
        penalty += 0.2
    if t_score < 0.6:
        return 0.0  # judul berbeda: jangan cocokkan hanya karena artisnya sama
    return 0.5 * t_score + 0.35 * a_score + 0.15 * d_score - penalty


def api_match(q):
    title = (q.get("title") or [""])[0].strip()
    artist = (q.get("artist") or [""])[0].strip()
    try:
        duration = int(float((q.get("duration") or ["0"])[0] or 0))
    except ValueError:
        duration = 0
    if not title:
        raise ValueError("title is required")

    def load():
        query = f"{_EXTRA.sub('', title) or title} {artist.split(',')[0].strip()}".strip()
        best, best_score = None, 0.0
        # Hasil teratas (tanpa filter) paling sering memuat lagu resmi; filter "songs"
        # kadang kosong tanpa login, jadi video dipakai sebagai cadangan terakhir.
        for f in (None, "songs", "videos"):
            try:
                found = tracks(ytm().search(query, filter=f, limit=8))[:8]
            except Exception:
                found = []
            for cand in found:
                s = _match_score(title, artist, duration, cand)
                if s > best_score:
                    best, best_score = cand, s
            if best_score >= 0.95:
                break  # lagu resmi sudah cocok, tidak perlu cari lagi
        ok = best is not None and best_score >= 0.72
        return {"track": best if ok else None, "score": round(best_score, 3)}

    return cached(f"match:{title.lower()}|{artist.lower()}|{duration}", 6 * 3600, load)


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
    "/api/import": api_import,
    "/api/match": api_match,
}


# --------------------------------------------------------------------------- #
# Audio: cari URL audio dengan yt-dlp, lalu teruskan ke browser
# --------------------------------------------------------------------------- #
VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
# m4a/AAC dulu karena Safari di iPhone tidak bisa memutar WebM/Opus.
AUDIO_FORMAT = "bestaudio[ext=m4a]/bestaudio[acodec^=mp4a]/bestaudio"


_inflight: dict = {}
_inflight_lock = threading.Lock()


def resolve_audio(vid: str, fresh: bool = False, full: bool = False) -> dict:
    """Audio link for a song. If the same song is already being looked up (e.g. it was
    prepared in the background and then tapped), wait for that lookup instead of
    starting a second one."""
    key = "audio:" + vid
    if not fresh:
        hit = cache.get(key)
        if hit:
            return hit
    with _inflight_lock:
        pending = None if fresh else _inflight.get(vid)
        if pending is None:
            pending = _inflight[vid] = {"event": threading.Event(), "result": None, "error": None}
            mine = True
        else:
            mine = False
    if not mine:
        pending["event"].wait(60)
        if pending["result"]:
            return pending["result"]
        raise pending["error"] or RuntimeError("audio lookup timed out")
    try:
        pending["result"] = _resolve_audio(vid, key, full)
        return pending["result"]
    except Exception as e:
        pending["error"] = e
        raise
    finally:
        pending["event"].set()
        with _inflight_lock:
            if _inflight.get(vid) is pending:
                del _inflight[vid]


# Fast path: one YouTube client that needs no JavaScript solving, and no extra page /
# manifest downloads. If it doesn't give a usable audio link, the normal (slower,
# complete) yt-dlp setup is used. After 3 misses in a row the fast path rests 30 min.
FAST_ARGS = {"youtube": {"player_client": ["visionos"], "player_skip": ["webpage", "configs"], "skip": ["dash", "hls", "translated_subs"]}}
_fast = {"misses": 0, "off_until": 0.0}


def _log(msg: str):
    sys.stderr.write("[%s] %s\n" % (time.strftime("%H:%M:%S"), msg))


def _extract(vid: str, extractor_args: dict | None):
    opts = {"format": AUDIO_FORMAT, "quiet": True, "no_warnings": True, "noplaylist": True, "skip_download": True}
    if extractor_args:
        opts["extractor_args"] = extractor_args
    with yt_dlp.YoutubeDL(opts) as ydl:
        return ydl.extract_info("https://www.youtube.com/watch?v=" + vid, download=False)


def _resolve_audio(vid: str, key: str, full: bool = False) -> dict:
    t0 = time.time()
    info, path = None, "full"
    if not full and time.time() >= _fast["off_until"]:
        try:
            info = _extract(vid, FAST_ARGS)
            if not (info.get("url") or info.get("requested_formats")):
                raise RuntimeError("no audio")
            path = "fast"
            _fast["misses"] = 0
        except Exception:
            info = None
            _fast["misses"] += 1
            if _fast["misses"] >= 3:
                _fast.update(misses=0, off_until=time.time() + 1800)
                _log("audio: fast lookup not working right now, using the full one for 30 min")
    if info is None:
        info = _extract(vid, None)
    fmt = info
    if not info.get("url") and info.get("requested_formats"):
        fmt = info["requested_formats"][0]
    data = {
        "url": fmt["url"],
        "headers": fmt.get("http_headers") or info.get("http_headers") or {},
        "ext": fmt.get("ext") or "m4a",
        "title": info.get("title") or vid,
        "size": int(fmt.get("filesize") or 0),  # total bytes; looked up on first request if missing
        "path": path,
    }
    # URL audio YouTube berlaku ±6 jam; simpan sedikit lebih singkat.
    ttl = 4 * 3600
    m = re.search(r"[?&]expire=(\d+)", data["url"])
    if m:
        ttl = max(60, min(ttl, int(m.group(1)) - time.time() - 30 * 60))
    cache.set(key, data, ttl)
    _disk_save(vid, data, time.time() + ttl)
    _log(f"audio link for {vid}: {time.time() - t0:.1f} s ({path})")
    return data


# Links are also kept on disk, so songs found earlier start right away after a restart.
DISK_CACHE = Path(__file__).resolve().parent / ".cache" / "audio-links.json"
_disk: dict = {}
_disk_lock = threading.Lock()


def _disk_load():
    try:
        raw = json.loads(DISK_CACHE.read_text("utf-8"))
    except (OSError, ValueError):
        return
    now = time.time()
    for vid, (data, until) in raw.items():
        if until - now > 120 and VIDEO_ID.match(vid):
            _disk[vid] = (data, until)
            cache.set("audio:" + vid, data, until - now)


def _disk_save(vid: str, data: dict, until: float):
    with _disk_lock:
        now = time.time()
        _disk[vid] = (data, until)
        for k in [k for k, (_, u) in _disk.items() if u < now]:
            del _disk[k]
        if len(_disk) > 400:
            for k in sorted(_disk, key=lambda k: _disk[k][1])[: len(_disk) - 400]:
                del _disk[k]
        try:
            DISK_CACHE.parent.mkdir(exist_ok=True)
            tmp = DISK_CACHE.with_suffix(".tmp")
            tmp.write_text(json.dumps(_disk), "utf-8")
            os.replace(tmp, DISK_CACHE)
        except OSError:
            pass


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

        t0 = time.time()
        info, up, total = open_audio(vid)

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
            first = True
            while pos <= end:
                stop = min(pos + chunk - 1, end)
                try:
                    for data in up.read_range(pos, stop):
                        self.wfile.write(data)
                        pos += len(data)
                        if first:
                            first = False
                            if end - start > 1:
                                _log(f"audio {vid} from {start}: first sound sent after {time.time() - t0:.2f} s")
                except UpstreamExpired:
                    if renewed:
                        raise
                    # The link expired mid-song: get a fresh one and carry on from `pos`.
                    renewed = True
                    up.close()
                    cache.drop("audio:" + vid)
                    up = Upstream(resolve_audio(vid, fresh=True, full=True))
                    continue
                chunk = CHUNK
        finally:
            up.close()


FIRST_CHUNK = 512 * 1024
CHUNK = 4 * 1024 * 1024


class UpstreamExpired(Exception):
    """The YouTube audio URL is no longer valid (403/410)."""


_pool: dict = {}
_pool_lock = threading.Lock()
POOL_IDLE = 25  # seconds a spare connection is kept for the next request


def _pool_get(key):
    with _pool_lock:
        conns = _pool.get(key) or []
        while conns:
            conn, since = conns.pop()
            if time.time() - since < POOL_IDLE:
                return conn
            try:
                conn.close()
            except Exception:
                pass
    return None


def _pool_put(key, conn):
    with _pool_lock:
        conns = _pool.setdefault(key, [])
        if len(conns) < 4:
            conns.append((conn, time.time()))
            return
    conn.close()


class Upstream:
    """One reusable connection to the audio host, fetching byte ranges. Finished
    connections go back to a small pool, so the next request (Safari sends several
    per song, and the next song often lives on the same host) skips the TLS handshake."""

    def __init__(self, info: dict):
        self.info = info
        u = urllib.parse.urlsplit(info["url"])
        self.https = u.scheme == "https"
        self.host = u.netloc
        self.path = u.path + ("?" + u.query if u.query else "")
        self.conn = None
        self.clean = True  # the connection has no unread response on it
        self.content_type = "audio/mp4" if info["ext"] == "m4a" else "audio/webm"

    def _connect(self):
        if self.conn is None:
            self.conn = _pool_get((self.https, self.host))
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
                self.clean = False
                conn.request("GET", self.path, headers=headers)
                resp = conn.getresponse()
            except (http.client.HTTPException, OSError):
                self.close()  # stale keep-alive connection: reconnect
                if attempt == 2:
                    raise
                continue
            if resp.status in (403, 410):
                resp.read()
                self.clean = True
                raise UpstreamExpired()
            if resp.status not in (200, 206):
                resp.read()
                self.clean = True
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
        self.clean = True
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
                self.clean = resp.isclosed() or resp.length in (0, None)
                break
            yield data

    def close(self):
        if self.conn is not None:
            if self.clean:
                _pool_put((self.https, self.host), self.conn)  # reuse for the next request
            else:
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

    _disk_load()
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
