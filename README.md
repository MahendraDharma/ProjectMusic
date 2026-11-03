# ProjectMusic 🎵

Pemutar musik **web** yang **gratis**, **ringan**, dan **open source**.

Lahir dari keresahan: aplikasi musik sekarang sedikit-sedikit berbayar, makin berat,
dan membebani HP lama. ProjectMusic mencoba kebalikannya — cukup buka di browser,
tanpa akun, tanpa iklan, tanpa install.

Terinspirasi dari [BitChord](https://github.com/kushagrasinghx/BitChord) (aplikasi
Android). Bedanya, ProjectMusic dibangun untuk web dan hanya memakai sumber musik
yang legal untuk di-*stream* gratis.

## Fitur

- 🔥 **Trending** dengan filter genre, dan 🔍 **pencarian** lagu/artis
- ▶️ Antrean, **acak**, **ulangi** (semua / satu lagu), lompat ke lagu mana pun di antrean
- ♥ **Favorit** & **riwayat putar** (disimpan di browser, tanpa akun)
- 📁 **Putar file musik lokal** dari HP/komputer — tidak diunggah ke mana pun
- 🔒 **Kontrol di layar kunci/notifikasi** (Media Session API) & tetap jalan di latar belakang
- 📲 **Bisa di-install** sebagai aplikasi (PWA) dan dibuka dari layar utama
- 🪶 **Super ringan**: tanpa framework, tanpa build, total kode ±50 KB

## Dari mana musiknya?

Musik streaming diambil dari **[Audius](https://audius.org)** — platform musik terbuka
tempat musisi independen membagikan karyanya. API-nya publik, gratis, dan tidak butuh
API key. Setiap lagu punya tautan ke halaman artisnya di Audius — dukung mereka!

> ProjectMusic tidak berafiliasi dengan Audius.

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
│       ├── audius.js     # sumber musik online (Audius API)
│       └── local.js      # sumber musik dari file perangkat
├── sw.js                 # service worker (PWA, cache aplikasi)
└── manifest.webmanifest  # metadata PWA
```

Setiap sumber musik mengembalikan objek **track** dengan bentuk yang sama
(`id, title, artist, artwork, duration, streamUrl, ...`), jadi menambah sumber baru
cukup dengan membuat file baru di `js/sources/`.

## Roadmap (ide ke depan)

- [ ] Playlist buatan sendiri (simpan, ubah nama, urutkan)
- [ ] Sumber tambahan: [Jamendo](https://developer.jamendo.com) (Creative Commons), [Internet Archive](https://archive.org/details/audio)
- [ ] Simpan musik lokal di IndexedDB agar tidak hilang saat halaman ditutup
- [ ] Baca tag ID3 (judul, artis, sampul) dari file lokal
- [ ] Lirik dari [LRCLIB](https://lrclib.net) (gratis, tanpa key)
- [ ] Sleep timer, kecepatan putar, crossfade
- [ ] Ekspor/impor favorit (backup JSON)
- [ ] Mode terang

## Lisensi & tata kelola

Kode dirilis di bawah [lisensi MIT](LICENSE) © MahendraDharma.
Proyek ini dikelola oleh satu maintainer — lihat [CONTRIBUTING.md](CONTRIBUTING.md).
