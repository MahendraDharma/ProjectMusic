// Local storage for everything personal: liked songs, history, settings, searches.
// Nothing leaves the browser. Every access is wrapped in try/catch so the app keeps
// working in private mode or when storage is full.
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
    /* storage full or blocked: ignore */
  }
}

// Local files use blob: URLs that vanish when the page closes, so they are never stored.
export const persistable = (t) => t && !t.ephemeral;

// Keep only the fields we need, so stored lists stay small.
export function slim(t) {
  const { id, source, title, artist, album, artwork, artworkLarge, duration, streamUrl, link, videoId } = t;
  return { id, source, title, artist, album, artwork, artworkLarge, duration, streamUrl, link, videoId };
}

/* ---------- Liked songs ---------- */
let liked = load('favorites', []);
export const favs = {
  all: () => liked.slice(),
  has: (id) => liked.some((t) => t.id === id),
  toggle(track) {
    if (!persistable(track)) return false;
    liked = favs.has(track.id) ? liked.filter((t) => t.id !== track.id) : [slim(track), ...liked];
    save('favorites', liked);
    return favs.has(track.id);
  },
};

/* ---------- Recently played ---------- */
const RECENT_MAX = 50;
let recent = load('recent', []);
export const history = {
  all: () => recent.slice(),
  push(track) {
    if (!persistable(track)) return;
    recent = [slim(track), ...recent.filter((t) => t.id !== track.id)].slice(0, RECENT_MAX);
    save('recent', recent);
  },
  clear() {
    recent = [];
    save('recent', recent);
  },
};

/* ---------- Recent searches ---------- */
let searches = load('searches', []);
export const recentSearches = {
  all: () => searches.slice(),
  add(q) {
    q = q.trim();
    if (!q) return;
    searches = [q, ...searches.filter((s) => s.toLowerCase() !== q.toLowerCase())].slice(0, 8);
    save('searches', searches);
  },
  remove(q) {
    searches = searches.filter((s) => s !== q);
    save('searches', searches);
  },
};

/* ---------- Settings ---------- */
const defaults = {
  lang: 'en',
  fade: 6, // seconds of fade-out/fade-in between songs (0 = off)
  glass: true, // translucent floating bars
  dataSaver: false,
  autoRadio: true,
  serverUrl: '',
  volume: 1,
  introSeen: false,
};
let settings = { ...defaults, ...load('settings', {}) };
export const prefs = {
  get: (k) => settings[k],
  set(k, v) {
    settings = { ...settings, [k]: v };
    save('settings', settings);
  },
};
