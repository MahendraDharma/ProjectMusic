// Sumber lagu: file audio di perangkat pengguna. Tidak ada yang di-upload ke mana pun;
// file dibaca langsung oleh browser lewat blob: URL.
let counter = 0;

function titleFromName(name) {
  const base = name.replace(/\.[^.]+$/, '').replace(/_/g, ' ').trim();
  // Pola umum "Artis - Judul"
  const parts = base.split(' - ');
  if (parts.length >= 2) return { artist: parts.shift().trim(), title: parts.join(' - ').trim() };
  return { artist: 'Local file', title: base || name };
}

export function fromFiles(fileList) {
  return Array.from(fileList)
    .filter((f) => f.type.startsWith('audio/') || /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|webm)$/i.test(f.name))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((file) => {
      const { artist, title } = titleFromName(file.name);
      return {
        id: `local:${++counter}:${file.name}`,
        source: 'local',
        title,
        artist,
        artwork: '',
        artworkLarge: '',
        duration: 0,
        streamUrl: URL.createObjectURL(file),
        ephemeral: true,
      };
    });
}
