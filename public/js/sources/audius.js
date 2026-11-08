// Sumber lagu: Audius (https://audius.org) — platform musik terbuka & terdesentralisasi.
// API publik, gratis, tanpa API key, dan mengizinkan akses langsung dari browser (CORS).
// Dokumentasi: https://docs.audius.org/developers/api
const HOST = 'https://api.audius.co';
const APP_NAME = 'projectmusic';

async function get(path, params = {}, signal) {
  const url = new URL('/v1' + path, HOST);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  }
  url.searchParams.set('app_name', APP_NAME);
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Audius error ${res.status}`);
  const json = await res.json();
  return json.data || [];
}

const streamable = (t) => t && t.is_streamable !== false && (!t.access || t.access.stream);

// Ubah data mentah Audius menjadi bentuk "track" yang dipakai seluruh aplikasi.
export function normalize(t) {
  const art = t.artwork || {};
  return {
    id: 'audius:' + t.id,
    source: 'audius',
    title: t.title || 'Untitled',
    artist: (t.user && t.user.name) || 'Unknown artist',
    artwork: art['150x150'] || '',
    artworkLarge: art['480x480'] || art['150x150'] || '',
    duration: t.duration || 0,
    streamUrl: `${HOST}/v1/tracks/${encodeURIComponent(t.id)}/stream?app_name=${APP_NAME}`,
    link: t.permalink ? 'https://audius.co' + t.permalink : '',
  };
}

const toTracks = (list) => list.filter(streamable).map(normalize);

/** Lagu trending. genre: string Audius (mis. "Electronic"), time: week|month|year|allTime */
export async function trending({ genre, time = 'week', limit = 40 } = {}, signal) {
  return toTracks(await get('/tracks/trending', { genre, time, limit }, signal));
}

/** Cari lagu berdasarkan kata kunci. */
export async function search(query, signal) {
  return toTracks(await get('/tracks/search', { query, limit: 40 }, signal));
}

export const GENRES = [
  'Electronic', 'Hip-Hop/Rap', 'Pop', 'Lo-Fi', 'Alternative',
  'R&B/Soul', 'Rock', 'Ambient', 'Jazz', 'Acoustic', 'Classical',
];
