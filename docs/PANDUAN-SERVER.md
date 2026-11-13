# Panduan server pribadi ProjectMusic

*English version: [SERVER-GUIDE.md](SERVER-GUIDE.md)*

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
3. Buka **Terminal**, lalu jalankan (sesuaikan lokasi foldernya):
   ```bash
   cd ~/Downloads/ProjectMusic-main && sh server/start.sh
   ```
   Atau klik dua kali `server/start.command` (kalau macOS menolak: klik kanan → **Open** → **Open**).
4. Buka <http://localhost:8080>.

### Linux (Ubuntu, Debian, Fedora, Arch, Mint, dan lainnya)
1. Pastikan Python 3.10+ terpasang. Kalau ada yang kurang, installer menampilkan perintah yang tepat untuk
   distro Anda, misalnya di Ubuntu/Debian:
   ```bash
   sudo apt install python3 python3-venv python3-pip
   ```
2. Unduh ProjectMusic (tombol hijau **Code → Download ZIP**, lalu ekstrak), atau clone:
   ```bash
   git clone https://github.com/MahendraDharma/ProjectMusic
   ```
3. Pasang untuk akun Anda (tanpa sudo). Ini menambahkan **ProjectMusic** ke menu aplikasi lengkap dengan ikonnya:
   ```bash
   sh ProjectMusic/server/install-linux.sh
   ```
   Ingin server menyala otomatis setiap kali login? Pakai perintah ini:
   ```bash
   sh ProjectMusic/server/install-linux.sh --autostart
   ```
4. Buka **ProjectMusic** dari menu aplikasi (GNOME, KDE, Xfce, Cinnamon, dll.). Server menyala di latar
   belakang dan browser membuka <http://localhost:8080>. Di Chrome/Edge, tekan **Install** di bilah alamat
   supaya terbuka di jendela sendiri.

Perintah berguna:

| Untuk | Perintah |
|---|---|
| Menyalakan tanpa menu | `sh ProjectMusic/server/linux-launch.sh` |
| Menjalankan di terminal (lihat log) | `sh ProjectMusic/server/start.sh` |
| Menghentikan layanan autostart | `systemctl --user stop projectmusic` |
| Menghapus menu dan autostart | `sh ProjectMusic/server/install-linux.sh --uninstall` |

Dengan `--autostart`, server berjalan sebagai layanan systemd milik pengguna bila tersedia (log:
`journalctl --user -u projectmusic`), atau lewat autostart desktop. Log peluncur ada di `server/server.log`.

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
- Alamat server bisa diganti di **Pengaturan (ikon slider) → Alamat server**.
- Bahasa aplikasi bisa diganti ke Bahasa Indonesia di **Pengaturan → Bahasa**.

## Kalau ada masalah

| Gejala | Solusi |
|---|---|
| Lagu tidak bisa diputar, padahal daftar lagu muncul | Tutup server lalu jalankan lagi skrip start: skrip otomatis memperbarui `yt-dlp`, yang biasanya memperbaikinya. |
| Muncul pesan "not a bot" | Server berjalan di jaringan yang diblokir YouTube (misalnya VPN atau hosting). Jalankan di Wi-Fi rumah atau data seluler biasa. |
| "not a bot" tetap muncul di rumah | Ekspor `cookies.txt` dari akun YouTube **cadangan** (format Netscape, misalnya dengan ekstensi browser "Get cookies.txt LOCALLY"), lalu jalankan server dengan `PM_COOKIES=/lokasi/cookies.txt`. `/api/health` akan menampilkan `"cookies": true`. YouTube bisa membatasi akun yang dipakai, jadi jangan pakai akun utama. |
| Lagu lama mulai, atau banyak yang gagal | Buka `/api/health`: `jsRuntime` harus berisi **deno** atau **node**. Kalau `false`, pasang [Deno](https://deno.land) 2.3+ (disarankan) atau Node.js 22+, lalu jalankan ulang server. Image Docker sudah berisi Deno. |
| Lagu berikutnya tidak lagi disiapkan duluan | Tanpa akun, YouTube mengizinkan sekitar 300 lagu per jam. Mendekati batas itu, server hanya mencari lagu saat diputar (`lookupsLastHour` di `/api/health`). Dengan `PM_COOKIES` batasnya lebih tinggi; `PM_YT_BUDGET` untuk mengaturnya sendiri. |
| Beberapa lagu gagal | Sebagian lagu dibatasi wilayah atau umur oleh YouTube; lewati saja. |
| Ingin tangga lagu negara lain | Jalankan dengan variabel `PM_COUNTRY`, misalnya `PM_COUNTRY=US sh start.sh`. |
| Port 8080 sudah dipakai | `sh start.sh --port 9090`, lalu buka `http://localhost:9090`. |

Sebagian fitur `yt-dlp` untuk YouTube butuh *JavaScript runtime*. Kalau beberapa lagu
selalu gagal, pasang [Deno](https://deno.com) atau Node.js di perangkat server, lalu jalankan
ulang server. Halaman `/api/health` menunjukkan `"jsRuntime": true` kalau sudah terdeteksi.
