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

/* ---------- Your playlists (made here or imported) ---------- */
let lists = load('playlists', []);
const saveLists = () => save('playlists', lists);
const newId = () => 'pl' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
export const playlists = {
  all: () => lists.slice(),
  get: (id) => lists.find((p) => p.id === id) || null,
  create({ name, tracks = [], cover = '', source = '', sourceUrl = '' }) {
    const pl = { id: newId(), name: (name || '').trim() || 'My playlist', cover, source, sourceUrl, created: Date.now(), tracks: tracks.filter(persistable).map(slim) };
    lists = [pl, ...lists];
    saveLists();
    return pl;
  },
  rename(id, name) {
    lists = lists.map((p) => (p.id === id ? { ...p, name: name.trim() || p.name } : p));
    saveLists();
  },
  remove(id) {
    lists = lists.filter((p) => p.id !== id);
    saveLists();
  },
  /** Adds a song (skips it if it is already there). Returns false when it was already in. */
  add(id, track) {
    let added = false;
    lists = lists.map((p) => {
      if (p.id !== id || !persistable(track) || p.tracks.some((t) => t.id === track.id)) return p;
      added = true;
      return { ...p, tracks: [...p.tracks, slim(track)] };
    });
    saveLists();
    return added;
  },
  removeAt(id, index) {
    lists = lists.map((p) => (p.id === id ? { ...p, tracks: p.tracks.filter((_, i) => i !== index) } : p));
    saveLists();
  },
};
