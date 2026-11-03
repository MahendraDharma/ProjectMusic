# Kontribusi

Terima kasih sudah tertarik dengan ProjectMusic!

## Tata kelola

ProjectMusic dikelola oleh **satu maintainer**: [MahendraDharma](https://github.com/mahendradharma).

- Kode boleh dipakai, dipelajari, dan di-*fork* siapa saja sesuai [lisensi MIT](LICENSE).
- Hanya maintainer yang bisa menggabungkan (*merge*) perubahan ke repository ini,
  menentukan arah fitur, dan membuat rilis.
- Issue dan pull request tetap diterima, tetapi keputusan akhir ada di tangan maintainer.

## Aturan dasar kode

- Tanpa framework dan tanpa *build step* — HTML, CSS, dan JavaScript (ES modules) murni,
  supaya tetap ringan di HP lama dan mudah dipelajari.
- Hindari `innerHTML` dengan data dari luar; pakai helper `h()` di `public/js/app.js`.
- Sumber musik baru harus **legal**: API resmi/publik yang mengizinkan streaming
  (contoh: Audius, Jamendo, Internet Archive). Tidak menerima kode yang membongkar
  DRM atau mengambil audio dari layanan berbayar tanpa izin.
