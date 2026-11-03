// Penyimpanan sederhana di localStorage (favorit, riwayat, pengaturan, antrean).
// Semua dibungkus try/catch: di mode private/penyimpanan penuh, aplikasi tetap jalan.
const PREFIX = 'pm:';

export function load(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* abaikan */
  }
}

// Lagu lokal memakai blob: URL yang hilang saat halaman ditutup, jadi tidak disimpan.
const persistable = (t) => t && !t.ephemeral;

/* ---------- Favorit ---------- */
let favorites = load('favorites', []);

export const favs = {
  all: () => favorites.slice(),
  has: (id) => favorites.some((t) => t.id === id),
  toggle(track) {
    if (!persistable(track)) return false;
    if (favs.has(track.id)) {
      favorites = favorites.filter((t) => t.id !== track.id);
    } else {
      favorites = [track, ...favorites];
    }
    save('favorites', favorites);
    return favs.has(track.id);
  },
};

/* ---------- Riwayat putar ---------- */
const RECENT_MAX = 30;
let recent = load('recent', []);

export const history = {
  all: () => recent.slice(),
  push(track) {
    if (!persistable(track)) return;
    recent = [track, ...recent.filter((t) => t.id !== track.id)].slice(0, RECENT_MAX);
    save('recent', recent);
  },
  clear() {
    recent = [];
    save('recent', recent);
  },
};

/* ---------- Pengaturan ---------- */
const defaults = { dataSaver: false };
let settings = { ...defaults, ...load('settings', {}) };

export const prefs = {
  get: (k) => settings[k],
  set(k, v) {
    settings = { ...settings, [k]: v };
    save('settings', settings);
  },
};

export { persistable };
