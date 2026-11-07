# Panduan server pribadi ProjectMusic

Server pribadi membuat ProjectMusic bisa memutar **lagu dari katalog YouTube Music**:
tangga lagu Indonesia, pencarian, halaman artis, radio otomatis, lirik, dan unduh.

> **Kenapa harus di perangkat sendiri?** YouTube memblokir permintaan dari server
> cloud/hosting ("Sign in to confirm you're not a bot"). Dari koneksi rumah atau
> data seluler biasa, tidak ada blokir. Cara ini sama dengan aplikasi seperti BitChord,
> yang juga berjalan langsung di HP penggunanya.
>
> Gunakan untuk **pemakaian pribadi** saja. Jangan buka server ini ke internet publik.

---

## 1. Laptop / PC

### Windows
1. Pasang **Python 3** dari <https://www.python.org/downloads/>.
   Saat memasang, **centang "Add python.exe to PATH"**.
2. Unduh ProjectMusic: tombol hijau **Code → Download ZIP** di halaman GitHub, lalu ekstrak.
3. Buka folder `server`, lalu **klik dua kali `start.bat`**.
   Pertama kali butuh sekitar 1 menit untuk menyiapkan semuanya.
4. Buka <http://localhost:8080> di browser.

### Mac
1. Pasang **Python 3** dari <https://www.python.org/downloads/>.
2. Unduh dan ekstrak ProjectMusic seperti di atas.
3. Di folder `server`, **klik dua kali `start.command`**.
   Kalau macOS menolak, klik kanan → **Open** → **Open**.
4. Buka <http://localhost:8080>.

### Linux
```bash
sh server/start.sh
```

## 2. HP Android (lewat Termux)

Cocok untuk HP Android lama yang bisa dibiarkan menyala sambil dicas.

1. Pasang **Termux** dari [F-Droid](https://f-droid.org/packages/com.termux/).
   Versi di Play Store sudah usang.
2. Di Termux, jalankan satu per satu:
   ```bash
   pkg install -y python git
   ```
   ```bash
   git clone https://github.com/MahendraDharma/ProjectMusic
   ```
   ```bash
   sh ProjectMusic/server/start.sh
   ```
3. Buka <http://localhost:8080> di Chrome HP itu.
4. Supaya tidak dimatikan Android saat layar mati: tarik notifikasi Termux → **Acquire wakelock**.

Untuk menyalakan lagi lain kali, cukup buka Termux lalu jalankan:
```bash
sh ProjectMusic/server/start.sh
```

## 3. Memakai dari HP lain (iPhone / Android)

Saat server jalan, layarnya menampilkan alamat seperti:

```
• Dari HP lain (Wi-Fi sama): http://192.168.1.5:8080
```

- **Di rumah (Wi-Fi yang sama):** buka alamat itu di Safari/Chrome.
- **Di luar rumah:** pasang **[Tailscale](https://tailscale.com/download)** di perangkat server
  dan di HP, lalu login dengan akun yang sama. Buka `http://<nama-perangkat-server>:8080`
  (nama perangkat terlihat di aplikasi Tailscale). Server tetap tertutup untuk orang lain.

Lalu jadikan aplikasi:
- **iPhone (Safari):** tombol Share → **Add to Home Screen**.
- **Android (Chrome):** menu ⋮ → **Tambahkan ke layar utama**.

## 4. Memakai link GitHub (tanpa mengetik localhost)

Saat server menyala, link **https://mahendradharma.github.io/ProjectMusic/** di perangkat
yang sama otomatis tersambung ke server dan menampilkan lagu YouTube Music.
Kalau server mati, link itu kembali ke musik indie Audius.

- Pakai **Chrome, Edge, atau Firefox**. Kalau muncul pertanyaan *"izinkan mengakses perangkat
  di jaringan lokal?"*, pilih **Izinkan**.
- **Safari** bisa memblokir sambungan dari situs HTTPS ke `localhost`. Kalau di Safari tetap
  muncul lagu Audius, buka `http://localhost:8080` saja, atau pakai Chrome.
- Alamat server bisa diganti di **Koleksi → Server pribadi**.

## Kalau ada masalah

| Gejala | Solusi |
|---|---|
| Lagu tidak bisa diputar, padahal daftar lagu muncul | Tutup server lalu jalankan lagi skrip start: skrip otomatis memperbarui `yt-dlp`, yang biasanya memperbaikinya. |
| Muncul pesan "not a bot" | Server berjalan di jaringan yang diblokir YouTube (misalnya VPN atau hosting). Jalankan di Wi-Fi rumah atau data seluler biasa. |
| Beberapa lagu gagal | Sebagian lagu dibatasi wilayah atau umur oleh YouTube; lewati saja. |
| Ingin tangga lagu negara lain | Jalankan dengan variabel `PM_COUNTRY`, misalnya `PM_COUNTRY=US sh start.sh`. |
| Port 8080 sudah dipakai | `sh start.sh --port 9090`, lalu buka `http://localhost:9090`. |

Sebagian fitur `yt-dlp` untuk YouTube butuh *JavaScript runtime*. Kalau beberapa lagu
selalu gagal, pasang [Deno](https://deno.com) atau Node.js di perangkat server, lalu jalankan
ulang server. Halaman `/api/health` menunjukkan `"jsRuntime": true` kalau sudah terdeteksi.
