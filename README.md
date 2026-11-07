# ProjectMusic 🎵

Pemutar musik **web** yang **gratis**, **ringan**, dan **open source**.

Lahir dari keresahan: aplikasi musik sekarang sedikit-sedikit berbayar, makin berat,
dan membebani HP lama. ProjectMusic mencoba kebalikannya — cukup buka di browser,
tanpa akun, tanpa iklan, tanpa install.

Terinspirasi dari [BitChord](https://github.com/kushagrasinghx/BitChord) (aplikasi
Android). Bedanya, ProjectMusic dibangun untuk web dan hanya memakai sumber musik
yang legal untuk di-*stream* gratis.

## Dua cara pakai

| | **Mode web** (GitHub Pages) | **Mode server pribadi** |
|---|---|---|
| Cara buka | Langsung buka link | Jalankan server di laptop/HP Android sendiri |
| Katalog lagu | Musik indie dari [Audius](https://audius.org) | **YouTube Music**: tangga lagu Indonesia, semua artis populer |
| Lirik, radio otomatis, unduh | ❌ | ✅ |
| Untuk siapa | Siapa saja | **Pemakaian pribadi** |

👉 **Panduan server pribadi (bahasa Indonesia):** [docs/PANDUAN-SERVER.md](docs/PANDUAN-SERVER.md)

## Fitur

- 🔥 Beranda: **Trending 20 Indonesia**, Top Music Videos, artis populer, dan rekomendasi dari lagu terakhir*
- 🔍 Pencarian lagu & artis, **halaman artis***
- 📻 **Radio otomatis**: antrean tidak pernah habis, terus disambung lagu yang mirip*
- 🎤 **Lirik tersinkron** dengan lagu (dari LRCLIB / YouTube Music), ketuk baris untuk lompat*
- ⬇️ **Unduh** lagu untuk disimpan*
- ▶️ Antrean, **acak**, **ulangi**, ⏲️ **sleep timer** (15/30/60 menit atau akhir lagu)
- ♥ **Favorit** & **riwayat putar** (disimpan di browser, tanpa akun)
- 📁 **Putar file musik lokal** dari HP/komputer
- 🔒 **Tetap jalan saat layar mati**, dengan kontrol di layar kunci (Media Session API)
- 📲 **Bisa di-install** sebagai aplikasi (PWA) di Android & iPhone
- 🪶 **Ringan**: tanpa framework, tanpa build

<sub>* fitur mode server pribadi</sub>

## Menjalankan di komputer sendiri

Tidak perlu `npm install`. Cukup jalankan web server statis di folder `public/`:

```bash
python3 -m http.server 8080 -d public
```

Lalu buka <http://localhost:8080>. (Membuka `index.html` langsung lewat `file://`
tidak akan jalan karena browser memblokir ES modules dari file lokal.)

Untuk mencoba di HP pada jaringan Wi-Fi yang sama, buka `http://<IP-komputer>:8080`.

## Deploy gratis (GitHub Pages)

1. Buka **Settings → Pages** di repository ini.
2. Pada **Source**, pilih **GitHub Actions**.
3. Setiap push ke branch `main` akan otomatis ter-deploy oleh
   [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml).

## Struktur kode

```
public/
├── index.html            # kerangka halaman + ikon SVG
├── css/style.css         # tampilan (mobile-first, tanpa efek berat)
├── js/
│   ├── app.js            # UI: router #/..., halaman, mini player
│   ├── player.js         # mesin pemutar: antrean, acak, ulangi, Media Session
│   ├── store.js          # favorit, riwayat, pengaturan (localStorage)
│   └── sources/
│       ├── audius.js     # sumber musik indie (Audius API)
│       ├── ytmusic.js    # sumber YouTube Music (lewat server pribadi)
│       └── local.js      # sumber musik dari file perangkat
├── sw.js                 # service worker (PWA, cache aplikasi)
└── manifest.webmanifest  # metadata PWA
server/
├── projectmusic_server.py  # server pribadi: katalog (ytmusicapi) + audio (yt-dlp)
├── requirements.txt
└── start.sh / start.bat / start.command   # klik dua kali untuk menyalakan
```

Setiap sumber musik mengembalikan objek **track** dengan bentuk yang sama
(`id, title, artist, artwork, duration, streamUrl, ...`), jadi menambah sumber baru
cukup dengan membuat file baru di `js/sources/`.

## Roadmap (ide ke depan)

- [ ] Playlist buatan sendiri (simpan, ubah nama, urutkan)
- [ ] Simpan musik lokal di IndexedDB agar tidak hilang saat halaman ditutup
- [ ] Baca tag ID3 (judul, artis, sampul) dari file lokal
- [ ] Kecepatan putar, crossfade
- [ ] Cache lagu untuk diputar offline
- [ ] Ekspor/impor favorit (backup JSON)
- [ ] Mode terang

## Terima kasih

Terinspirasi dari [BitChord](https://github.com/kushagrasinghx/BitChord) dan
[ytify](https://github.com/n-ce/ytify). Memakai [ytmusicapi](https://github.com/sigma67/ytmusicapi),
[yt-dlp](https://github.com/yt-dlp/yt-dlp), [LRCLIB](https://lrclib.net), dan [Audius](https://audius.org).

ProjectMusic tidak berafiliasi dengan YouTube, Google, maupun Audius. Mode server pribadi
mengakses YouTube secara tidak resmi; penggunaannya tunduk pada Ketentuan Layanan YouTube
dan menjadi tanggung jawab masing-masing pengguna.

## Lisensi & tata kelola

Kode dirilis di bawah [lisensi MIT](LICENSE) © MahendraDharma.
Proyek ini dikelola oleh satu maintainer — lihat [CONTRIBUTING.md](CONTRIBUTING.md).
