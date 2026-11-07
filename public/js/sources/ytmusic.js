// Sumber lagu: YouTube Music, lewat server pribadi ProjectMusic (folder server/).
// Hanya aktif kalau halaman ini dibuka dari server tersebut — bukan dari GitHub Pages.

async function api(path, params = {}, signal) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch('api/' + path + (qs ? '?' + qs : ''), { signal });
  let data = null;
  try { data = await res.json(); } catch { /* bukan JSON */ }
  if (!res.ok) throw new Error((data && data.error) || `Server error ${res.status}`);
  return data;
}

/** Cek apakah server ProjectMusic tersedia. Cepat menyerah agar tidak menunda tampilan. */
export async function detect() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2500);
  try {
    const info = await api('health', {}, ctrl.signal);
    return info && info.mode === 'server' ? info : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export const home = (signal) => api('home', {}, signal);
export const search = (q, signal) => api('search', { q }, signal);
export const artist = (id, signal) => api('artist', { id }, signal);
export const playlist = (id, signal) => api('playlist', { id }, signal);
export const next = (videoId, signal) => api('next', { id: videoId }, signal).then((d) => d.tracks || []);

export function lyrics(track, signal) {
  return api('lyrics', {
    id: track.videoId || '',
    title: track.title,
    artist: track.artist,
    duration: Math.round(track.duration || 0),
  }, signal);
}

export const downloadUrl = (track) => `api/stream?id=${encodeURIComponent(track.videoId)}&download=1`;
