"""Offline tests for matching YouTube Music songs to SoundCloud uploads.

Run from the server folder:  python -m unittest test_soundcloud_matching -v
The titles below are real SoundCloud search results (November 2026); no network is used.
"""
import unittest
from unittest import mock

import soundcloud_source as sc

HLS_AAC = {"format": {"protocol": "hls", "mime_type": 'audio/mp4; codecs="mp4a.40.2"'}, "preset": "aac_160k", "url": "x"}
HLS_DRM = {"format": {"protocol": "ctr-encrypted-hls", "mime_type": 'audio/mp4; codecs="mp4a.40.2"'}, "url": "x"}
SNIP = {"format": {"protocol": "hls", "mime_type": "audio/mpeg"}, "snipped": True, "url": "x"}


def track(title, seconds, user="someone", policy="MONETIZE", transcodings=(HLS_AAC,), plays=1000, publisher=""):
    return {
        "title": title,
        "full_duration": int(seconds * 1000),
        "duration": int(seconds * 1000),
        "user": {"username": user},
        "publisher_metadata": {"artist": publisher} if publisher else {},
        "policy": policy,
        "playback_count": plays,
        "media": {"transcodings": list(transcodings)},
    }


# Bernadya – "Untungnya, Hidup Harus Tetap Berjalan", 183 s on YouTube Music.
BERNADYA = ("Untungnya, Hidup Harus Tetap Berjalan", "Bernadya", 183)
BERNADYA_RESULTS = [
    track("Bernadya - Untungnya, Hidup Harus Tetap Berjalan (Odyseven Amapiano Edit)", 167.8, "Odyseven"),
    track("Bernadya - Untungnya, Hidup Harus Tetap Berjalan (Dipha Barus Edit)", 173.7, "DiphaBarus"),
    track("Bernadya - Untungnya, Hidup Harus Tetap Berjalan Pop Punk Cover.mp3", 198.2, "andriprasetyaef"),
    track("Untungnya, Hidup Harus Tetap Berjalan Bernadya Pop Punk Cover By Boeda", 185.4, "tugupahlawan"),
    track("Untungnya Hidup Harus Tetap Berjalan - Bernadya (Reggae SKA Version).m4a", 209.2, "I Gusti Putu Nurdhyana"),
    track("BERNADYA -UNTUNGNYA, HIDUP HARUS TETAP BERJALAN- COVER BY ALVIA OLW", 182.9, "Alvia Olw"),
    track("Bernadya - Untungnya Hidup Harus Tetap Berjalan (ROCK VERSION By DCMD)", 215.9, "tugupahlawan"),
    track("Untungnya, Hidup Harus Tetap Berjalan", 182.9, "Bernadya", policy="SNIP", transcodings=(SNIP,)),
    track("Bernadya - Untungnya, Hidup Harus Tetap Berjalan (Jersey Club Remix) prod. cvplis", 181.2, "cvplis"),
    track("DJ UNTUNGNYA HIDUP HARUS TETAP BERJALAN x SATU BULAN - BERNADYA FUNKOT", 1429.4, "faisalhky."),
    track("Untungnya, Hidup Harus Tetap Berjalan - Bernadya (Cover)", 183.6, "Nayli Nazri"),
    track("Bernadya - Untungnya, Hidup Harus Tetap Berjalan", 173.5, "Huccain Joshua"),
    track("DJ UNTUNGNYA, HIDUP HARUS TETAP BERJALAN - BERNADYA BOOTLEG 2024", 323.6, "Lexzy777"),
]


class LabelWords(unittest.TestCase):
    """Label words in brackets or after " - " must not reject the original."""

    def accept(self, sc_title, seconds=184):
        score = sc._score(track(sc_title, seconds, "Bernadya"), *BERNADYA)
        self.assertIsNotNone(score, f"should accept: {sc_title} ({sc.judge(track(sc_title, seconds, 'Bernadya'), *BERNADYA)[1]})")

    def test_official_lyric_video(self):
        self.accept("Bernadya - Untungnya, Hidup Harus Tetap Berjalan (Official Lyric Video)")

    def test_lirik(self):
        self.accept("Untungnya, Hidup Harus Tetap Berjalan [Lirik]", 183)

    def test_official_audio_after_dash(self):
        self.accept("Bernadya - Untungnya, Hidup Harus Tetap Berjalan - Official Audio", 185)

    def test_official_music_video_and_hd(self):
        self.accept("Bernadya - Untungnya, Hidup Harus Tetap Berjalan (Official Music Video) [HD]")

    def test_visualizer(self):
        self.accept("Bernadya - Untungnya, Hidup Harus Tetap Berjalan (Official Visualizer)")

    def test_album_version_is_the_original(self):
        self.accept("Bernadya - Untungnya, Hidup Harus Tetap Berjalan (Album Version)")

    def test_video_lirik_in_indonesian(self):
        self.accept("Bernadya - Untungnya, Hidup Harus Tetap Berjalan (Video Lirik Resmi)")


class OtherVersions(unittest.TestCase):
    """Slowed, sped up, remix, cover, karaoke, instrumental, DJ, edit, nightcore and 8D stay out."""

    def reject(self, sc_title, word, seconds=183):
        score, why = sc.judge(track(sc_title, seconds, "Bernadya"), *BERNADYA)
        self.assertIsNone(score, f"should reject: {sc_title}")
        self.assertIn(word, why)

    def test_each_version_word(self):
        cases = {
            "slowed": "Bernadya - Untungnya, Hidup Harus Tetap Berjalan (Slowed + Reverb)",
            "sped up": "Bernadya - Untungnya, Hidup Harus Tetap Berjalan (Sped Up)",
            "remix": "Bernadya - Untungnya, Hidup Harus Tetap Berjalan (Jersey Club Remix)",
            "cover": "Untungnya, Hidup Harus Tetap Berjalan - Bernadya (Cover)",
            "karaoke": "Bernadya - Untungnya, Hidup Harus Tetap Berjalan (Karaoke)",
            "instrumental": "Bernadya - Untungnya, Hidup Harus Tetap Berjalan (Instrumental)",
            "dj": "DJ Untungnya, Hidup Harus Tetap Berjalan - Bernadya",
            "edit": "Bernadya - Untungnya, Hidup Harus Tetap Berjalan (Dipha Barus Edit)",
            "nightcore": "Nightcore - Untungnya, Hidup Harus Tetap Berjalan (Bernadya)",
            "8d": "Bernadya - Untungnya, Hidup Harus Tetap Berjalan (8D Audio)",
        }
        for word, title in cases.items():
            with self.subTest(word=word):
                self.reject(title, word)

    def test_label_words_do_not_hide_a_version(self):
        self.reject("Bernadya - Untungnya, Hidup Harus Tetap Berjalan (Official Remix Video)", "remix")
        self.reject("Bernadya - Untungnya, Hidup Harus Tetap Berjalan [Lirik] (Cover)", "cover")

    def test_genre_versions(self):
        self.reject("Bernadya - Untungnya Hidup Harus Tetap Berjalan (ROCK VERSION By DCMD)", "version")
        self.reject("Bernadya - Untungnya, Hidup Harus Tetap Berjalan (Versi Akustik)", "akustik")
        self.reject("Untungnya Hidup Harus Tetap Berjalan Koplo Version - Bernadya", "other version")
        self.reject("Bernadya - Untungnya Hidup Harus Tetap Berjalan (Koplo)", "koplo")

    def test_version_word_allowed_when_the_original_has_it(self):
        song = ("Tak Segampang Itu (Live)", "Anggi Marito", 240)
        score = sc._score(track("Anggi Marito - Tak Segampang Itu (Live)", 240, "Anggi Marito"), *song)
        self.assertIsNotNone(score)


class LengthAndTitle(unittest.TestCase):
    def test_length_tolerance(self):
        ok = sc._score(track("Bernadya - Untungnya, Hidup Harus Tetap Berjalan", 187.5, "Bernadya"), *BERNADYA)
        too_far = sc._score(track("Bernadya - Untungnya, Hidup Harus Tetap Berjalan", 173.5, "Huccain Joshua"), *BERNADYA)
        self.assertIsNotNone(ok)       # 4.5 s off: within max(4, 2.5%)
        self.assertIsNone(too_far)     # 9.5 s off

    def test_preview_length_is_rejected(self):
        self.assertIsNone(sc._score(track("Bernadya - Untungnya, Hidup Harus Tetap Berjalan", 30, "Bernadya"), *BERNADYA))

    def test_different_title(self):
        self.assertIsNone(sc._score(track("Bernadya - Satu Bulan", 183, "Bernadya"), *BERNADYA))

    def test_unknown_uploader_needs_exact_length(self):
        song = ("Hati-Hati di Jalan", "Tulus", 242)
        self.assertIsNotNone(sc._score(track("Hati-Hati di Jalan", 242.6, "random"), *song))
        self.assertIsNone(sc._score(track("Hati-Hati di Jalan", 245.0, "random"), *song))

    def test_artist_in_publisher_metadata(self):
        song = ("Evaluasi", "Hindia", 215)
        self.assertIsNotNone(sc._score(track("Evaluasi", 218, "Sun Eater", publisher="Hindia"), *song))


class Picking(unittest.TestCase):
    def test_bernadya_real_results_have_no_full_original(self):
        """All full-length candidates are covers/edits; the original is a 30-s preview (SNIP)."""
        tr, why = sc.pick(BERNADYA_RESULTS, *BERNADYA)
        self.assertIsNone(tr)
        self.assertIn("preview/DRM only", why)

    def test_full_original_is_picked_over_covers(self):
        results = BERNADYA_RESULTS + [
            track("Bernadya - Untungnya, Hidup Harus Tetap Berjalan (Official Audio)", 184.1, "Bernadya", plays=50),
        ]
        tr, why = sc.pick(results, *BERNADYA)
        self.assertEqual(why, "ok")
        self.assertEqual(tr["user"]["username"], "Bernadya")

    def test_closest_length_wins_between_originals(self):
        a = track("Bernadya - Untungnya, Hidup Harus Tetap Berjalan", 186.5, "Bernadya")
        b = track("Bernadya - Untungnya, Hidup Harus Tetap Berjalan", 183.2, "Bernadya")
        self.assertIs(sc.pick([a, b], *BERNADYA)[0], b)

    def test_drm_only_upload_is_not_used(self):
        drm = track("Bernadya - Untungnya, Hidup Harus Tetap Berjalan", 183, "Bernadya", transcodings=(HLS_DRM,))
        tr, why = sc.pick([drm], *BERNADYA)
        self.assertIsNone(tr)
        self.assertIn("preview/DRM only", why)

    def test_find_uses_search_results_without_network(self):
        official = track("Bernadya - Untungnya, Hidup Harus Tetap Berjalan (Lirik)", 183.4, "Bernadya")
        with mock.patch.object(sc, "_api", return_value={"collection": BERNADYA_RESULTS + [official]}) as api:
            self.assertIs(sc.find(*BERNADYA), official)
        query = api.call_args[0][1]["q"]
        self.assertTrue(query.startswith("Bernadya Untungnya"))


if __name__ == "__main__":
    unittest.main()
