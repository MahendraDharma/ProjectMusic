// Sumber lagu: YouTube Music, lewat server pribadi ProjectMusic (folder server/).
// Bisa dibuka dari server itu sendiri (localhost:8080), atau dari GitHub Pages yang
// tersambung ke server di perangkat Anda.

export const DEFAULT_SERVER = 'http://localhost:8080/';

// '' = server yang sama dengan halaman ini; selain itu alamat lengkap, diakhiri '/'.
let base = '';
export const getBase = () => base;
export function normalizeBase(url) {
  url = (url || '').trim();
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) url = 'http://' + url;
  return url.replace(/\/*$/, '/');
}

async function api(path, params = {}, signal) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(base + 'api/' + path + (qs ? '?' + qs : ''), { signal });
  let data = null;
  try { data = await res.json(); } catch { /* bukan JSON */ }
  if (!res.ok) throw new Error((data && data.error) || `Server error ${res.status}`);
  return data;
}

async function probe(candidate) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2500);
  try {
    const res = await fetch(candidate + 'api/health', { signal: ctrl.signal });
    const info = res.ok ? await res.json() : null;
    return info && info.mode === 'server' ? info : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Cari server ProjectMusic: (1) server yang menyajikan halaman ini, (2) alamat yang
 * disimpan di Pengaturan, (3) localhost:8080. Cepat menyerah agar tampilan tidak tertunda.
 */
export async function detect(savedUrl) {
  const candidates = [''];
  const saved = normalizeBase(savedUrl);
  if (saved) candidates.push(saved);
  if (!saved || saved !== DEFAULT_SERVER) candidates.push(DEFAULT_SERVER);
  for (const c of candidates) {
    if (c && new URL(c).origin === location.origin) continue; // sama dengan '' di atas
    const info = await probe(c);
    if (info) {
      base = c;
      return { ...info, base: c || location.origin + '/' };
    }
  }
  base = '';
  return null;
}

export const home = (signal) => api('home', {}, signal);
export const search = (q, signal) => api('search', { q }, signal);
export const artist = (id, signal) => api('artist', { id }, signal);
export const playlist = (id, signal) => api('playlist', { id }, signal);
export const next = (videoId, signal) => api('next', { id: videoId }, signal).then((d) => d.tracks || []);

/** Read a playlist link from YouTube Music, Spotify, Apple Music or Deezer. */
export const importList = (url, signal) => api('import', { url }, signal);
/** Find the same song on YouTube Music. Resolves to a track or null. */
export const match = (song, signal) => api('match', {
  title: song.title,
  artist: song.artist || '',
  duration: Math.round(song.duration || 0),
}, signal).then((d) => d.track || null);

export function lyrics(track, signal) {
  return api('lyrics', {
    id: track.videoId || '',
    title: track.title,
    artist: track.artist,
    duration: Math.round(track.duration || 0),
  }, signal);
}

export const streamUrl = (track) => `${base}api/stream?id=${encodeURIComponent(track.videoId)}`;
export const downloadUrl = (track) => streamUrl(track) + '&download=1';
/** Real length of a song in seconds (0 if unknown). */
export const meta = (track) => api('meta', { id: track.videoId }).then((d) => d.duration || 0).catch(() => 0);
/** Ask the server to look up a song's audio link ahead of time (fire and forget). */
const prepared = new Map(); // videoId -> time asked, so each song is asked for once
export function prepare(track) {
  if (!track || track.source !== 'ytmusic' || !track.videoId) return;
  const last = prepared.get(track.videoId);
  if (last && Date.now() - last < 3 * 3600 * 1000) return; // audio links last ~6 h
  prepared.set(track.videoId, Date.now());
  fetch(`${base}api/prepare?id=${encodeURIComponent(track.videoId)}`)
    .then((r) => r.json())
    .then((d) => { if (d && d.queued === false) prepared.delete(track.videoId); }) // server busy: ask again later
    .catch(() => prepared.delete(track.videoId));
}
// Artwork through the server, with CORS, so it can be drawn on a <canvas> (share cards, colours).
export const imageUrl = (url) => (url ? `${base}api/image?url=${encodeURIComponent(url)}` : '');
