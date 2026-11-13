"""Playback reliability test against a running ProjectMusic server.

Plays songs from tests/songs.json the way the app does: while one song "plays", the next
one is prepared (/api/prepare), then its audio is requested (/api/stream) and the time to
the first bytes is measured. Run it on the server machine (victus) or any device on the
same Tailscale network:

    cd server && .venv/bin/python tests/reliability.py --plays 1000
    cd server && .venv/bin/python tests/reliability.py --plays 50 --gap 5 --server http://victus:8080

--gap is the seconds each song "plays" before the next one starts. The default (20 s)
keeps a 1000-play run near 180 songs an hour, under YouTube's limit for a guest session
(~300/hour); with PM_COOKIES set on the server a shorter gap is fine. Press Ctrl+C at any
time for the summary. Every play is also written to tests/reliability-<time>.csv.
"""
import argparse
import csv
import json
import random
import statistics
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
FIRST_BYTES = 256 * 1024  # about 8-15 s of audio: enough to know playback started


def get_json(base, path, params=None, timeout=60):
    url = base + path + ("?" + urllib.parse.urlencode(params) if params else "")
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return json.loads(r.read())


def video_id(base, song):
    """The song's videoId from songs.json, or the first matching search result."""
    if song.get("videoId"):
        return song["videoId"]
    try:
        res = get_json(base, "api/search", {"q": f"{song['artist'].split(',')[0]} {song['title']}"})
    except Exception:
        return None
    for t in res.get("tracks") or []:
        if t.get("videoId"):
            song["videoId"] = t["videoId"]
            return t["videoId"]
    return None


def song_params(song, vid):
    return {"id": vid, "t": song["title"], "a": song["artist"], "d": song["duration"]}


def play(base, song, vid):
    """(ok, seconds to first audio, bytes, note)"""
    url = base + "api/stream?" + urllib.parse.urlencode(song_params(song, vid))
    req = urllib.request.Request(url, headers={"Range": f"bytes=0-{FIRST_BYTES - 1}"})
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            first = r.read(1)
            ttfa = time.time() - t0
            rest = r.read()
            got = len(first) + len(rest)
            ok = r.status in (200, 206) and got >= min(FIRST_BYTES, 64 * 1024)
            return ok, ttfa, got, f"HTTP {r.status}"
    except urllib.error.HTTPError as e:
        return False, time.time() - t0, 0, f"HTTP {e.code}"
    except Exception as e:
        return False, time.time() - t0, 0, e.__class__.__name__


def pct(values, p):
    if not values:
        return 0.0
    values = sorted(values)
    return values[min(len(values) - 1, int(round(p / 100 * (len(values) - 1))))]


def summary(rows, health):
    total = len(rows)
    if not total:
        print("no plays")
        return
    ok = [r for r in rows if r["ok"]]
    times = [r["seconds"] for r in ok]
    print("\n" + "=" * 60)
    print(f"plays: {total}   ok: {len(ok)} ({100 * len(ok) / total:.1f}%)   failed: {total - len(ok)}")
    if times:
        print(f"time to first audio: median {statistics.median(times):.2f} s · p90 {pct(times, 90):.2f} s · max {max(times):.2f} s")
        fast = sum(1 for t in times if t <= 2)
        print(f"started within 2 s: {fast}/{len(times)} ({100 * fast / len(times):.0f}%)")
    for region in sorted({r["region"] for r in rows}):
        rr = [r for r in rows if r["region"] == region]
        print(f"  {region:<11} {sum(r['ok'] for r in rr)}/{len(rr)} ok")
    failed = {}
    for r in rows:
        if not r["ok"]:
            failed.setdefault(f"{r['artist']} - {r['title']}", []).append(r["note"])
    if failed:
        print("failed songs:")
        for name, notes in sorted(failed.items(), key=lambda kv: -len(kv[1]))[:20]:
            print(f"  {len(notes)}x {name}  ({', '.join(sorted(set(notes)))})")
    if health:
        print(f"server: version {health.get('version')} · yt-dlp {health.get('ytdlp')} · JS runtime {health.get('jsRuntime')} · "
              f"cookies {health.get('cookies')} · YouTube lookups last hour {health.get('lookupsLastHour')}/{health.get('lookupBudget')}")
    print("=" * 60)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--server", default="http://localhost:8080/")
    ap.add_argument("--plays", type=int, default=100)
    ap.add_argument("--gap", type=float, default=20.0, help="seconds each song 'plays' before the next")
    ap.add_argument("--seed", type=int, default=None)
    args = ap.parse_args()
    base = args.server.rstrip("/") + "/"
    songs = json.loads((HERE / "songs.json").read_text("utf-8"))["songs"]
    rnd = random.Random(args.seed)
    order = []
    while len(order) < args.plays + 1:
        batch = songs[:]
        rnd.shuffle(batch)
        order += batch
    try:
        health = get_json(base, "api/health", timeout=10)
    except Exception as e:
        sys.exit(f"server not reachable at {base}: {e}")
    print(f"server {base} · version {health.get('version')} · yt-dlp {health.get('ytdlp')} · JS runtime {health.get('jsRuntime')}")
    log_path = HERE / f"reliability-{time.strftime('%Y%m%d-%H%M%S')}.csv"
    rows = []
    with open(log_path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["n", "time", "region", "artist", "title", "videoId", "ok", "seconds", "bytes", "note"])
        w.writeheader()
        try:
            for n in range(args.plays):
                song, nxt = order[n], order[n + 1]
                vid = video_id(base, song)
                if not vid:
                    ok, secs, got, note = False, 0.0, 0, "no videoId"
                else:
                    ok, secs, got, note = play(base, song, vid)
                row = {"n": n + 1, "time": time.strftime("%H:%M:%S"), "region": song["region"], "artist": song["artist"],
                       "title": song["title"], "videoId": vid, "ok": ok, "seconds": round(secs, 3), "bytes": got, "note": note}
                rows.append(row)
                w.writerow(row)
                f.flush()
                print(f"{n + 1:>4} {'OK ' if ok else 'FAIL'} {secs:5.2f}s  {song['artist']} - {song['title']}  {'' if ok else note}")
                # like the app: get the next song ready while this one "plays"
                nvid = video_id(base, nxt)
                if nvid:
                    try:
                        get_json(base, "api/prepare", song_params(nxt, nvid), timeout=10)
                    except Exception:
                        pass
                time.sleep(args.gap)
        except KeyboardInterrupt:
            print("\nstopped")
    try:
        health = get_json(base, "api/health", timeout=10)
    except Exception:
        pass
    summary(rows, health)
    print(f"log: {log_path}")


if __name__ == "__main__":
    main()
