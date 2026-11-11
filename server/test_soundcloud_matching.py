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

    def test_declared_other_artist_is_rejected_even_with_exact_length(self):
        # real case (found while testing JioSaavn): "Cruel Summer" by the cover act Night Cascade, 177 s vs 178 s
        song = ("Cruel Summer", "Taylor Swift", 178)
        self.assertIsNone(sc._score(track("Cruel Summer", 177, "Night Cascade", publisher="Night Cascade"), *song))
        self.assertIsNotNone(sc._score(track("Cruel Summer", 177.5, "Taylor Swift", publisher="Taylor Swift"), *song))

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


def ok(sc_title, song, seconds=None, user="uploader"):
    title, artist, duration = song
    return sc._score(track(sc_title, seconds or duration, user), title, artist, duration)


class Japanese(unittest.TestCase):
    """Kana/kanji are kept; original and romaji/translated titles and artist names both match."""

    def test_normalization_keeps_kana_and_kanji(self):
        self.assertEqual(sc._norm("クリスマスソング"), "クリスマスソング")
        self.assertEqual(sc._norm("米津玄師 - Lemon"), "米津玄師lemon")
        self.assertEqual(sc._norm("ＹＯＡＳＯＢＩ「アイドル」"), "yoasobiアイドル")  # NFKC: full-width letters
        self.assertEqual(sc._norm("Beyoncé"), "beyonce")                     # Latin accents only

    def test_title_with_translation(self):
        self.assertEqual(sc.title_variants("クリスマスソング - Christmas Song"),
                         ["クリスマスソングchristmassong", "クリスマスソング", "christmassong"])
        self.assertEqual(sc.title_variants("アイドル (Idol)"), ["アイドル", "idol"])

    def test_back_number(self):
        song = ("クリスマスソング", "back number", 296)
        self.assertIsNotNone(ok("back number「クリスマスソング」", song, 296.4, "back number"))
        self.assertIsNotNone(ok("クリスマスソング - back number (Christmas Song)", song, 297))
        # YouTube title with the English name: the romaji-only upload matches too
        self.assertIsNotNone(ok("back number - Christmas Song", ("クリスマスソング - Christmas Song", "back number", 296), 296.8))
        # artist written in katakana on SoundCloud
        self.assertIsNotNone(ok("バックナンバー - クリスマスソング", song, 298))

    def test_yoasobi(self):
        song = ("アイドル", "YOASOBI", 213)
        self.assertIsNotNone(ok("YOASOBI「アイドル」Official Music Video", song, 214))
        self.assertIsNotNone(ok("Idol - YOASOBI", ("アイドル (Idol)", "YOASOBI", 213), 213.5))
        self.assertIsNone(ok("【歌ってみた】アイドル / YOASOBI", song, 213))
        self.assertIsNone(ok("アイドル (Idol) - YOASOBI [Piano Cover]", song, 213))
        self.assertIsNone(ok("YOASOBI - アイドル (Sped Up)", song, 213))

    def test_official_hige_dandism(self):
        song = ("Pretender", "Official HIGE DANdism", 326)
        self.assertIsNotNone(ok("Official髭男dism - Pretender［Official Video］", song, 327, "Official髭男dism"))
        self.assertIsNotNone(ok("ヒゲダン Pretender", song, 325))
        self.assertIsNone(ok("Official髭男dism - Pretender (Acoustic ver.)", song, 326))

    def test_kenshi_yonezu(self):
        song = ("Lemon", "Kenshi Yonezu", 255)
        self.assertIsNotNone(ok("米津玄師 - Lemon", song, 256, "米津玄師"))
        self.assertIsNotNone(ok("Kenshi Yonezu - Lemon (Official Audio)", song, 255))
        self.assertIsNone(ok("Lemon - 米津玄師 (オルゴール)", song, 255))
        self.assertIsNone(ok("米津玄師 - Lemon (カバー)", song, 255))

    def test_version_brackets_are_not_names(self):
        # "(movie ver.)" says which version it is; it must not match other songs on its own
        song = ("前前前世 (movie ver.)", "RADWIMPS", 286)
        self.assertEqual(sc.title_variants(song[0]), ["前前前世"])
        self.assertIsNotNone(ok("RADWIMPS - 前前前世 (movie ver.)", song, 286.4))
        self.assertIsNone(ok("RADWIMPS - スパークル (movie ver.)", song, 286))
        self.assertEqual(sc.title_variants("紅蓮華 (TV size)"), ["紅蓮華"])

    def test_ado_in_lenticular_brackets(self):
        self.assertIsNotNone(ok("【Ado】うっせぇわ", ("うっせぇわ", "Ado", 205), 205.4))
        self.assertIsNotNone(ok("【MV】うっせぇわ - Ado", ("うっせぇわ", "Ado", 205), 205.4))

    def test_other_singer_in_lenticular_brackets(self):
        # real SoundCloud result: a cover by another singer, named in 【】
        self.assertIsNone(ok("【Yugo Asuma】うっせぇわ (Usseewa) - Ado", ("うっせぇわ", "Ado", 205), 203))

    def test_korean_cover_marked_original_song(self):
        # real SoundCloud result: 원곡 = "original song by" -> a cover
        song = ("Pretender", "Official HIGE DANdism", 326)
        self.assertIsNone(ok("프리텐더[pretender]-강남 (원곡:Official hige dandism)", song, 322))


class Western(unittest.TestCase):
    def test_taylor_swift(self):
        self.assertIsNotNone(ok("Taylor Swift - Anti-Hero (Official Audio)", ("Anti-Hero", "Taylor Swift", 200), 201))
        self.assertIsNone(ok("Taylor Swift - Cruel Summer (Live From The Eras Tour)", ("Cruel Summer", "Taylor Swift", 178)))
        # "(Taylor's Version)" is part of the real title, so it must not reject
        self.assertIsNotNone(ok("Taylor Swift - Love Story (Taylor's Version)", ("Love Story (Taylor's Version)", "Taylor Swift", 235)))

    def test_the_weeknd(self):
        song = ("Blinding Lights", "The Weeknd", 200)
        self.assertIsNotNone(ok("The Weeknd - Blinding Lights", song, 200.2))
        self.assertIsNone(ok("The Weeknd - Blinding Lights (Slowed)", song))
        self.assertIsNone(ok("The Weeknd - Blinding Lights (Nightcore)", song))

    def test_mashup_with_x(self):
        # real SoundCloud result: "Yellow - Coldplay X OZ" by OVERZEALOUS
        self.assertIsNone(ok("Yellow - Coldplay X OZ", ("Yellow", "Coldplay", 269), 271))
        # a real collaboration listed on YouTube Music still matches
        self.assertIsNotNone(ok("Coldplay x BTS - My Universe", ("My Universe", "Coldplay, BTS", 228), 228))

    def test_coldplay(self):
        song = ("Yellow", "Coldplay", 269)
        self.assertIsNotNone(ok("Yellow - Coldplay", song, 268.5))
        self.assertIsNone(ok("Coldplay - Yellow (Live in Buenos Aires)", song))
        self.assertIsNone(ok("Coldplay - Viva La Vida", ("Yellow", "Coldplay", 269)))

    def test_number_title(self):
        song = ("505", "Arctic Monkeys", 254)
        self.assertEqual(sc.title_variants("505"), ["505"])
        self.assertIsNotNone(ok("Arctic Monkeys - 505", song, 254.3))
        self.assertIsNone(ok("Arctic Monkeys - 505 (Live at the Royal Albert Hall)", song, 254))

    def test_accented_artist(self):
        self.assertIsNotNone(ok("Beyonce - Halo", ("Halo", "Beyoncé", 261), 262))


class Indonesian(unittest.TestCase):
    def test_tulus_and_nadin(self):
        self.assertIsNotNone(ok("TULUS - Hati-Hati di Jalan", ("Hati-Hati di Jalan", "Tulus", 242), 242.6))
        self.assertIsNotNone(ok("Nadin Amizah - Bertaut (Official Lyric Video)", ("Bertaut", "Nadin Amizah", 321), 322))
        self.assertIsNone(ok("Nadin Amizah - Bertaut (Versi Koplo)", ("Bertaut", "Nadin Amizah", 321)))


class RealFalseMatches(unittest.TestCase):
    """Uploads that live SoundCloud searches for songs.json returned, which are NOT the original."""

    def test_rejected(self):
        cases = [
            ("Yeji ITZY- Cruel Summer (by. Taylor Swift)", ("Cruel Summer", "Taylor Swift", 178), 177),
            ("Viva La Vida - Coldplay Tribute", ("Viva La Vida", "Coldplay", 242), 247 - 4),
            ("Ed Sheeran & Sia - Shape of You / The Greatest", ("Shape of You", "Ed Sheeran", 233), 236),
            ("drivers license - Olivia Rodrigo (Grammy Awards 2022)", ("drivers license", "Olivia Rodrigo", 242), 244),
            ("KICK BACK - Chainsaw Man OP [Piano] - Kenshi Yonezu", ("KICK BACK", "Kenshi Yonezu", 193), 196),
            ("Fujii Kaze - 死ぬのがいいわ(Shinunoga E-Wa) by THIS IS PIANO", ("死ぬのがいいわ", "Fujii Kaze", 186), 187),
            ("ドライフラワー Dry Flower(Original by Yuuri優里 )", ("ドライフラワー", "Yuuri", 286), 286),
            ("Lantas Juicy Luicy - Billy Joe Ava", ("Lantas", "Juicy Luicy", 234), 229 + 4),
            ("Taylor Swift - Cruel Summer (Different Font Flip)", ("Cruel Summer", "Taylor Swift", 178), 175),
            ("【kenshi Yonezu】KICK BACK (chainsaw Man Op)【shuu Saku】", ("KICK BACK", "Kenshi Yonezu", 193), 195),
            ("怪獣の花唄 - Vaundy【ノリノリREMIX】", ("怪獣の花唄", "Vaundy", 225), 228),
            ("OG full bling bang bang born but slightly louder", ("Bling-Bang-Bang-Born", "Creepy Nuts", 169), 166),
        ]
        for sc_title, song, seconds in cases:
            with self.subTest(sc_title):
                self.assertIsNone(ok(sc_title, song, seconds), sc.judge(track(sc_title, seconds), *song))

    def test_still_accepted(self):
        cases = [
            ("米津玄師 Kenshi Yonezu - Lemon", ("Lemon", "Kenshi Yonezu", 256), 254),
            ("あいみょん AIMYON - マリーゴールド Marigold", ("マリーゴールド", "Aimyon", 308), 303 + 4),
            ("Halu - Feby Putri", ("Halu", "Feby Putri", 265), 263),
            ("Fiersa Besari - Waktu Yang Salah", ("Waktu Yang Salah", "Fiersa Besari", 324), 324),
            ("Lady Gaga & Bruno Mars - Die With A Smile", ("Die With A Smile", "Lady Gaga, Bruno Mars", 250), 251),
            ("Simon & Garfunkel - The Sound of Silence", ("The Sound of Silence", "Simon & Garfunkel", 185), 185),
            ("YOASOBI「夜に駆ける」Racing Into The Night", ("夜に駆ける", "YOASOBI", 261), 260),
            ("Stand By Me - Ben E. King", ("Stand By Me", "Ben E. King", 180), 180),
            ("【MV】うっせぇわ【Ado】", ("うっせぇわ", "Ado", 205), 205),
            ("紅蓮華【Official Audio】- LiSA", ("紅蓮華", "LiSA", 239), 239),
            ("Kenshi Yonezu - KICK BACK (Chainsaw Man OP)", ("KICK BACK", "Kenshi Yonezu", 193), 194),
        ]
        for sc_title, song, seconds in cases:
            with self.subTest(sc_title):
                self.assertIsNotNone(ok(sc_title, song, seconds), sc.judge(track(sc_title, seconds), *song))


class SongList(unittest.TestCase):
    """server/tests/songs.json: the 60-song list for the reliability test."""

    def test_songs_json(self):
        import json
        from pathlib import Path
        doc = json.loads((Path(__file__).resolve().parent / "tests" / "songs.json").read_text("utf-8"))
        songs = doc["songs"]
        self.assertEqual(len(songs), 60)
        for region in ("western", "japanese", "indonesian"):
            self.assertEqual(sum(s["region"] == region for s in songs), 20, region)
        self.assertEqual(len({s["id"] for s in songs}), 60)
        for s in songs:
            self.assertTrue(s["title"] and s["artist"], s)
            self.assertTrue(90 <= s["duration"] <= 420, s)
            self.assertTrue(sc.title_variants(s["title"]), s)        # every title survives normalization
            self.assertTrue(sc.artist_variants(s["artist"]), s)


if __name__ == "__main__":
    unittest.main()
