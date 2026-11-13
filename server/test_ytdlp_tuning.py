"""Offline tests for how the server drives yt-dlp (no network).

Run from the server folder:  python -m unittest test_ytdlp_tuning -v
"""
import threading
import time
import unittest
from unittest import mock

import projectmusic_server as pm


class FakeYDL:
    made = 0

    def __init__(self, opts):
        FakeYDL.made += 1
        self.opts = opts
        self.saved = 0

    def extract_info(self, url, download=False):
        time.sleep(0.05)
        return {"url": "https://example.invalid/a", "ext": "m4a", "title": url[-11:], "duration": 200}

    def save_cookies(self):
        self.saved += 1


class Requests(unittest.TestCase):
    def test_both_paths_skip_the_next_request(self):
        # the "next"/initial-data request is never read and is the slowest one
        self.assertIn("initial_data", pm.FAST_ARGS["youtube"]["player_skip"])
        self.assertIn("initial_data", pm.FULL_ARGS["youtube"]["player_skip"])
        self.assertEqual(pm.FAST_ARGS["youtube"]["player_client"], ["visionos"])
        self.assertNotIn("player_client", pm.FULL_ARGS["youtube"])  # full path keeps yt-dlp's defaults
        self.assertIn("hls", pm.FULL_ARGS["youtube"]["skip"])
        self.assertNotIn("hls", pm.SAFE_ARGS["youtube"]["skip"])     # last resort keeps the manifests

    def test_full_path_falls_back_to_safe_when_no_audio(self):
        calls = []

        def fake(vid, args):
            calls.append({id(pm.FAST_ARGS): "fast", id(pm.FULL_ARGS): "full", id(pm.SAFE_ARGS): "safe"}[id(args)])
            if args is pm.SAFE_ARGS:
                return {"url": "https://example.invalid/a?expire=9999999999", "ext": "m4a", "duration": 200}
            return {}  # no usable audio

        with mock.patch.object(pm, "_extract", side_effect=fake), mock.patch.object(pm, "_disk_save"):
            data = pm._resolve_audio("ddddddddddd", "audio:ddddddddddd")
        self.assertEqual(calls, ["fast", "full", "safe"])
        self.assertEqual(data["path"], "safe")

    def test_refused_song_is_not_asked_again(self):
        calls = []

        def fake(vid, args):
            calls.append(args)
            raise RuntimeError("Sign in to confirm you're not a bot")

        with mock.patch.object(pm, "_extract", side_effect=fake), mock.patch.object(pm, "_fast", {"misses": 0, "off_until": 0.0}):
            with self.assertRaises(RuntimeError):
                pm._resolve_audio("eeeeeeeeeee", "audio:eeeeeeeeeee")
        self.assertEqual(len(calls), 2)  # fast + full, no third try


class JsRuntimes(unittest.TestCase):
    def find(self, which, versions):
        with mock.patch.object(pm.shutil, "which", side_effect=lambda n: which.get(n)), \
                mock.patch.object(pm, "_version", side_effect=lambda cmd: versions[cmd[0]]):
            return pm._find_js_runtimes()

    def test_node_is_named_explicitly(self):
        # yt-dlp only looks for Deno by itself: Node must be passed or it is never used
        got = self.find({"node": "/usr/bin/node"}, {"/usr/bin/node": (22, 11, 0)})
        self.assertEqual(got, {"node": {"path": "/usr/bin/node"}})

    def test_versions_yt_dlp_does_not_support_are_left_out(self):
        got = self.find({"deno": "/d", "node": "/n", "bun": "/b"}, {"/d": (2, 1, 0), "/n": (20, 5, 0), "/b": (1, 3, 20)})
        self.assertEqual(got, {})

    def test_deno_first_when_present(self):
        got = self.find({"deno": "/d", "node": "/n"}, {"/d": (2, 5, 0), "/n": (22, 0, 0)})
        self.assertEqual(list(got), ["deno", "node"])

    def test_runtimes_and_cookies_reach_yt_dlp(self):
        with mock.patch.object(pm, "JS_RUNTIMES", {"node": {"path": "/n"}}), \
                mock.patch.object(pm, "COOKIE_FILE", pm.Path("/tmp/c.txt")), \
                mock.patch.object(pm.yt_dlp, "YoutubeDL", FakeYDL):
            ydl = pm._YdlPool(pm.FULL_ARGS)._new()
        self.assertEqual(ydl.opts["js_runtimes"], {"node": {"path": "/n"}})
        self.assertEqual(ydl.opts["cookiefile"], "/tmp/c.txt")
        self.assertIs(ydl.opts["extractor_args"], pm.FULL_ARGS)


class Pool(unittest.TestCase):
    def test_instances_are_reused(self):
        FakeYDL.made = 0
        with mock.patch.object(pm.yt_dlp, "YoutubeDL", FakeYDL):
            pool = pm._YdlPool(pm.FULL_ARGS)
            for i in range(10):
                pool.extract(f"vid{i:08d}")
        self.assertEqual(FakeYDL.made, 1)  # one instance for ten songs in a row

    def test_parallel_lookups_are_capped(self):
        FakeYDL.made = 0
        with mock.patch.object(pm.yt_dlp, "YoutubeDL", FakeYDL):
            pool = pm._YdlPool(pm.FULL_ARGS)
            ts = [threading.Thread(target=pool.extract, args=(f"vid{i:08d}",)) for i in range(8)]
            [t.start() for t in ts]
            [t.join() for t in ts]
        self.assertLessEqual(FakeYDL.made, pm._YdlPool.SIZE)

    def test_cookies_are_saved_after_each_lookup(self):
        with mock.patch.object(pm.yt_dlp, "YoutubeDL", FakeYDL), mock.patch.object(pm, "COOKIE_FILE", pm.Path("/tmp/c.txt")):
            pool = pm._YdlPool(pm.FULL_ARGS)
            pool.extract("aaaaaaaaaaa")
            pool.extract("bbbbbbbbbbb")
            ydl = pool.free.get_nowait()
        self.assertEqual(ydl.saved, 2)


class Budget(unittest.TestCase):
    def setUp(self):
        pm._lookups.clear()
        pm.cache.drop("audio:ccccccccccc")
        pm._blocked.pop("ccccccccccc", None)

    def test_default_budget_depends_on_cookies(self):
        with mock.patch.dict(pm.os.environ, {"PM_YT_BUDGET": ""}):
            with mock.patch.object(pm, "COOKIE_FILE", None):
                self.assertEqual(pm.lookup_budget(), 240)
            with mock.patch.object(pm, "COOKIE_FILE", pm.Path("/tmp/c.txt")):
                self.assertEqual(pm.lookup_budget(), 1500)
        with mock.patch.dict(pm.os.environ, {"PM_YT_BUDGET": "50"}):
            self.assertEqual(pm.lookup_budget(), 50)

    def test_preparing_stops_near_the_limit_but_playback_does_not(self):
        with mock.patch.dict(pm.os.environ, {"PM_YT_BUDGET": "10"}):
            for _ in range(8):
                pm._note_lookup()
            res = pm.api_prepare({"id": ["ccccccccccc"]})
        self.assertEqual(res, {"ok": True, "queued": False, "budget": True})

    def test_old_lookups_drop_out(self):
        pm._lookups.extend([time.time() - 4000] * 5)
        pm._note_lookup()
        self.assertEqual(pm.lookups_last_hour(), 1)


if __name__ == "__main__":
    unittest.main()
