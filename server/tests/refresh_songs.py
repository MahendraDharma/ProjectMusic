"""Fill server/tests/songs.json with YouTube Music's own videoId and length.

Run on the machine that does the reliability test (YouTube Music search needs a normal
home connection; from cloud machines the "songs" results are often empty):

    cd server && .venv/bin/python tests/refresh_songs.py            # show what would change
    cd server && .venv/bin/python tests/refresh_songs.py --write    # save it

A song whose YouTube Music length differs from the official recording by more than 3 s
is listed for a manual look (it may be a live or remastered upload).
"""
import json
import re
import sys
import unicodedata
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

import projectmusic_server as pm  # noqa: E402

SKIP = ("live", "remix", "acoustic", "instrumental", "karaoke", "sped", "slowed", "tv size", "off vocal", "cover")
# Latin <-> original names, so "Kenshi Yonezu" also matches "米津玄師" in YouTube Music's data
ALIASES = [("Kenshi Yonezu", "米津玄師"), ("Official HIGE DANdism", "Official髭男dism"), ("Aimyon", "あいみょん"),
           ("Fujii Kaze", "藤井風"), ("Yuuri", "優里"), ("Yorushika", "ヨルシカ")]


def norm(s: str) -> str:
    """Letters and digits only, any script (kana/kanji kept)."""
    return re.sub(r"[\W_]+", "", unicodedata.normalize("NFKC", s or "").casefold())


def artist_names(artist: str) -> set:
    first = re.split(r",|&", artist or "")[0]
    names = {norm(first)}
    for group in ALIASES:
        if names & {norm(x) for x in group}:
            names |= {norm(x) for x in group}
    return {n for n in names if n}


def lookup(song):
    want_t = norm(re.sub(r"\(.*?\)", "", song["title"])) or norm(song["title"])
    want_a = artist_names(song["artist"])
    try:
        results = pm.ytm().search(f"{song['artist'].split(',')[0]} {song['title']}", filter="songs", limit=10)
    except Exception as e:  # network trouble: keep the old values
        print(f"  search failed: {e}")
        return None
    best = None
    for item in results:
        t = pm.track(item)
        if not t or not t.get("duration"):
            continue
        title = item.get("title") or ""
        if want_t not in norm(title) or not any(a in norm(t["artist"] + title) for a in want_a):
            continue
        if any(w in title.lower() for w in SKIP if w not in song["title"].lower()):
            continue
        diff = abs(t["duration"] - song["duration"])
        if best is None or diff < best[0]:
            best = (diff, t)
    return best[1] if best else None


def main():
    write = "--write" in sys.argv
    path = HERE / "songs.json"
    doc = json.loads(path.read_text("utf-8"))
    found, check = 0, []
    for song in doc["songs"]:
        t = lookup(song)
        if not t:
            print(f"{song['id']}  NOT FOUND on YouTube Music: {song['artist']} - {song['title']}")
            continue
        found += 1
        diff = t["duration"] - song["duration"]
        flag = "  <-- check" if abs(diff) > 3 else ""
        if flag:
            check.append(song["id"])
        print(f"{song['id']}  {song['artist']} - {song['title']}: {song['duration']}s -> {t['duration']}s ({diff:+d}) {t['videoId']}{flag}")
        song.update(duration=t["duration"], duration_source="ytmusic", videoId=t["videoId"])
    print(f"\n{found}/{len(doc['songs'])} found on YouTube Music; differs > 3 s: {', '.join(check) or 'none'}")
    if write:
        path.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n", "utf-8")
        print(f"saved {path}")
    else:
        print("(dry run: add --write to save)")


if __name__ == "__main__":
    main()
