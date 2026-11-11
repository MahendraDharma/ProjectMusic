"""SoundCloud sebagai sumber audio cepat untuk lagu dari katalog YouTube Music.

Untuk satu lagu (judul, artis, durasi dari YouTube Music) dicari unggahan yang sama di
SoundCloud. Hanya stream HLS AAC yang TIDAK terenkripsi yang dipakai; lagu ber-DRM dan
pratinjau 30 detik dilewati. Segmen HLS (fMP4) diunduh paralel lalu digabung menjadi satu
file .m4a di cache, sehingga browser (termasuk Safari di iPhone) bisa memutar dan
menggeser posisi lagu seperti file biasa.

Pencocokan dibuat ketat: durasi harus hampir sama, judul harus memuat judul aslinya, dan
versi lain (slowed, remix, cover, karaoke, ...) ditolak kecuali judul aslinya memang begitu.
"""
from __future__ import annotations

import concurrent.futures
import json
import math
import os
import re
import threading
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

API = "https://api-v2.soundcloud.com"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/141.0 Safari/537.36")
CACHE_DIR = Path(__file__).resolve().parent / ".cache" / "sc"
MAX_FILES = int(os.environ.get("PM_SC_CACHE_FILES", "400"))
MISS_FOR = 6 * 3600          # lagu yang tidak ketemu: jangan dicari lagi selama 6 jam
OTHER_VERSIONS = ("slowed", "sped up", "speed up", "speedup", "nightcore", "remix", "rmx", "bootleg",
                  "cover", "karaoke", "instrumental", "reverb", "8d", "mashup", "lofi", "lo fi", "live",
                  "acoustic", "akustik", "versi", "version", "mix", "dj ", "edit", "minus one", "tiktok")
NOISE = re.compile(r"\((?:[^)]*)\)|\[(?:[^]]*)\]|\b(official|video|music|lyrics?|lirik|audio|mv|hd|hq)\b", re.I)

_lock = threading.Lock()
_inflight: dict = {}
_miss: dict = {}
_cid = {"id": None}
_log = lambda msg: None  # diganti oleh server  # noqa: E731


def set_logger(fn):
    global _log
    _log = fn


# --------------------------------------------------------------------------- HTTP
def _get(url: str, timeout: float = 10, raw: bool = False):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        data = r.read()
    return data if raw else data.decode("utf-8", "replace")


def _client_id(force: bool = False) -> str:
    """Public web client id, read from SoundCloud's own web app (kept on disk)."""
    store = CACHE_DIR / "client_id.json"
    if not force and _cid["id"]:
        return _cid["id"]
    if not force:
        try:
            saved = json.loads(store.read_text())
            if time.time() - saved["t"] < 24 * 3600:
                _cid["id"] = saved["id"]
                return _cid["id"]
        except (OSError, ValueError, KeyError):
            pass
    html = _get("https://soundcloud.com/")
    for src in reversed(re.findall(r'<script[^>]+src="(https://a-v2\.sndcdn\.com/assets/[^"]+\.js)"', html)):
        m = re.search(r'client_id\s*[:=]\s*"([0-9a-zA-Z]{32})"', _get(src))
        if m:
            _cid["id"] = m.group(1)
            CACHE_DIR.mkdir(parents=True, exist_ok=True)
            store.write_text(json.dumps({"id": _cid["id"], "t": time.time()}))
            return _cid["id"]
    raise RuntimeError("SoundCloud client id not found")


def _api(path: str, params: dict | None = None, timeout: float = 8):
    for attempt in (0, 1):
        q = dict(params or {}, client_id=_client_id(force=attempt == 1))
        url = (path if path.startswith("http") else API + path)
        url += ("&" if "?" in url else "?") + urllib.parse.urlencode(q)
        try:
            return json.loads(_get(url, timeout))
        except urllib.error.HTTPError as e:
            if e.code in (401, 403) and attempt == 0:
                continue  # client id ganti: ambil yang baru sekali
            raise


# --------------------------------------------------------------------------- matching
def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "", s)


def _words(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    return " " + re.sub(r"[^a-z0-9]+", " ", s).strip() + " "


def _core_title(title: str) -> str:
    return _norm(NOISE.sub(" ", title or "")) or _norm(title)


def _playable(tr: dict):
    """Best plain (not encrypted) HLS AAC transcoding of a track, or None."""
    if tr.get("policy") in ("SNIP", "BLOCK"):
        return None
    best = None
    for tc in (tr.get("media") or {}).get("transcodings") or []:
        fmt = tc.get("format") or {}
        if fmt.get("protocol") != "hls" or "mp4" not in (fmt.get("mime_type") or ""):
            continue  # encrypted HLS (DRM) and mp3/opus are skipped
        if tc.get("snipped"):
            continue
        rank = 2 if "160" in (tc.get("preset") or "") else 1
        if not best or rank > best[0]:
            best = (rank, tc)
    return best[1] if best else None


def _score(tr: dict, title: str, artist: str, duration: int) -> float | None:
    sc_title = tr.get("title") or ""
    user = ((tr.get("user") or {}).get("username") or "")
    pub = ((tr.get("publisher_metadata") or {}).get("artist") or "")
    sc_dur = (tr.get("full_duration") or tr.get("duration") or 0) / 1000
    if sc_dur < 45:
        return None
    if duration:
        diff = abs(sc_dur - duration)
        if diff > max(4.0, duration * 0.025):
            return None
    core = _core_title(title)
    if not core or core not in _norm(sc_title):
        return None
    yt_words, sc_words = _words(title + " " + artist), _words(sc_title)
    for w in OTHER_VERSIONS:
        if (" " + w.strip() + " ") in sc_words and (" " + w.strip() + " ") not in yt_words:
            return None
    first_artist = _norm(re.split(r",|&| x | ft\.? | feat\.? ", artist or "", flags=re.I)[0])
    artist_hit = bool(first_artist) and first_artist in _norm(sc_title + " " + user + " " + pub)
    if not artist_hit and not (duration and abs(sc_dur - duration) <= 1.5):
        return None
    score = 10.0 if artist_hit else 4.0
    if duration:
        score += 5.0 - abs(sc_dur - duration)
    score += math.log10((tr.get("playback_count") or 0) + 10)
    if _norm(sc_title) == _norm(f"{artist}{title}") or _norm(sc_title) == core:
        score += 2
    return score


def find(title: str, artist: str, duration: int) -> dict | None:
    first_artist = re.split(r",|&| x | ft\.? | feat\.? ", artist or "", flags=re.I)[0].strip()
    q = f"{first_artist} {NOISE.sub(' ', title)}".strip()
    res = _api("/search/tracks", {"q": q, "limit": 20, "linked_partitioning": 1})
    best = None
    for tr in res.get("collection") or []:
        if not _playable(tr):
            continue
        s = _score(tr, title, artist, duration)
        if s is not None and (not best or s > best[0]):
            best = (s, tr)
    return best[1] if best else None


# --------------------------------------------------------------------------- audio
def _download(tr: dict, dest: Path):
    tc = _playable(tr)
    params = {}
    if tr.get("track_authorization"):
        params["track_authorization"] = tr["track_authorization"]
    m3u8 = _api(tc["url"], params)["url"]
    playlist = _get(m3u8)
    init = re.search(r'#EXT-X-MAP:URI="([^"]+)"', playlist)
    segs = [ln.strip() for ln in playlist.splitlines() if ln.strip() and not ln.startswith("#")]
    urls = ([init.group(1)] if init else []) + [urllib.parse.urljoin(m3u8, s) for s in segs]
    if not urls:
        raise RuntimeError("empty SoundCloud playlist")
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        parts = list(pool.map(lambda u: _get(u, 15, raw=True), urls))
    tmp = dest.with_suffix(".part")
    with open(tmp, "wb") as f:
        for p in parts:
            f.write(p)
    os.replace(tmp, dest)


def _prune():
    files = sorted(CACHE_DIR.glob("*.m4a"), key=lambda p: p.stat().st_mtime)
    for p in files[: max(0, len(files) - MAX_FILES)]:
        try:
            p.unlink()
            p.with_suffix(".json").unlink(missing_ok=True)
        except OSError:
            pass


def cached(vid: str) -> Path | None:
    p = CACHE_DIR / f"{vid}.m4a"
    if p.exists():
        os.utime(p)  # dipakai lagi: jangan dihapus duluan
        return p
    return None


def known_miss(vid: str) -> bool:
    return _miss.get(vid, 0) > time.time()


def audio_file(vid: str, title: str, artist: str, duration: int) -> Path | None:
    """Path of the song as a cached .m4a, or None if SoundCloud has no good match."""
    hit = cached(vid)
    if hit:
        return hit
    if known_miss(vid) or not title:
        return None
    with _lock:
        ev = _inflight.get(vid)
        mine = ev is None
        if mine:
            ev = _inflight[vid] = threading.Event()
    if not mine:
        ev.wait(30)
        return cached(vid)
    t0 = time.time()
    try:
        tr = find(title, artist, duration)
        if not tr:
            _miss[vid] = time.time() + MISS_FOR
            _log(f"soundcloud {vid}: no good match for '{artist} - {title}' ({time.time() - t0:.1f} s)")
            return None
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        dest = CACHE_DIR / f"{vid}.m4a"
        _download(tr, dest)
        dest.with_suffix(".json").write_text(json.dumps({
            "sc_id": tr.get("id"), "title": tr.get("title"), "user": (tr.get("user") or {}).get("username"),
            "duration": (tr.get("full_duration") or tr.get("duration") or 0) / 1000, "for": [artist, title, duration],
        }))
        _prune()
        _log(f"soundcloud {vid}: '{tr.get('title')}' ready in {time.time() - t0:.1f} s")
        return dest
    except Exception as e:
        _miss[vid] = time.time() + 600  # error sementara: coba lagi 10 menit lagi
        _log(f"soundcloud {vid}: {e.__class__.__name__}: {str(e)[:80]}")
        return None
    finally:
        with _lock:
            _inflight.pop(vid, None)
        ev.set()
