# Menjalankan server ProjectMusic dengan Docker

Cara ini cocok untuk laptop atau PC yang dijadikan server 24/7. Container
otomatis menyala lagi setelah reboot.

```bash
git clone https://github.com/MahendraDharma/ProjectMusic.git
cd ProjectMusic
docker compose -f docker/compose.yaml up -d --build
```

Buka `http://<alamat-server>:8080`. Cek kondisi server di `/api/health`.

## Memperbarui

```bash
git pull
docker compose -f docker/compose.yaml up -d --build
```

`yt-dlp` sudah diperbarui otomatis setiap container start. Pembaruan otomatis
bawaan server dimatikan (`PM_AUTO_UPDATE=0`), karena versi diatur lewat `git pull`.

## Catatan

- Server ini untuk **pemakaian pribadi**. Jangan dibuka ke publik tanpa pembatas
  akses, karena siapa pun yang tahu alamatnya bisa memakai server Anda.
- Jika YouTube sering menolak dengan pesan "Sign in to confirm you're not a bot",
  lihat bagian pemecahan masalah di [SERVER-GUIDE](../docs/SERVER-GUIDE.md).
