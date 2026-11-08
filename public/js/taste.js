// On-device taste model. Every finished or skipped song becomes one event; from those we
// score artists (with time decay) and detect songs the listener keeps skipping.
// Used for "Made for you", "Your top artists" and to order the autoplay radio.
// Nothing is uploaded anywhere.
import { load, save, persistable, slim } from './store.js';

const KEY = 'taste';
const MAX_EVENTS = 400;
const HALF_LIFE_DAYS = 21; // a play from three weeks ago counts half
const DAY = 86400000;

let events = load(KEY, []);

const mainArtist = (t) => (t.artist || '').split(',')[0].trim();

/** Record one listen. `listened` and `duration` are in seconds. */
export function record(track, listened, duration) {
  if (!persistable(track) || !track.artist) return;
  if (listened < 3) return; // accidental taps don't count
  events.push({ t: slim(track), a: mainArtist(track), ts: Date.now(), l: Math.round(listened), d: Math.round(duration || 0) });
  if (events.length > MAX_EVENTS) events = events.slice(-MAX_EVENTS);
  save(KEY, events);
}

export function reset() {
  events = [];
  save(KEY, events);
}

function weightOf(e) {
  const ratio = e.d > 0 ? Math.min(1, e.l / e.d) : Math.min(1, e.l / 180);
  const skipped = e.l < 30 && ratio < 0.5;
  const decay = Math.pow(0.5, (Date.now() - e.ts) / DAY / HALF_LIFE_DAYS);
  return { w: (skipped ? -0.6 : 0.2 + ratio) * decay, skipped };
}

/** Map of artist name (lower case) → score. */
export function artistScores() {
  const scores = new Map();
  for (const e of events) {
    const key = e.a.toLowerCase();
    if (!key) continue;
    scores.set(key, (scores.get(key) || 0) + weightOf(e).w);
  }
  return scores;
}

/** Top artists with a representative song each (the most recent one listened through). */
export function topArtists(n = 6) {
  const scores = artistScores();
  const best = new Map();
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    const key = e.a.toLowerCase();
    if (!best.has(key) && !weightOf(e).skipped) best.set(key, e);
  }
  return [...scores.entries()]
    .filter(([key, s]) => s > 0.3 && best.has(key))
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([key, score]) => ({ name: best.get(key).a, score, seed: best.get(key).t }));
}

/** How many times a song was skipped in the last 30 days. */
export function skipCount(id) {
  const since = Date.now() - 30 * DAY;
  return events.filter((e) => e.t.id === id && e.ts > since && weightOf(e).skipped).length;
}

function playedRecently(id, days) {
  const since = Date.now() - days * DAY;
  return events.some((e) => e.t.id === id && e.ts > since);
}

/**
 * Re-order candidate songs for this listener: favour liked artists, prefer songs not
 * heard in the last two days, push down songs that keep getting skipped. A little
 * randomness keeps the radio from feeling identical every time.
 */
export function rank(candidates) {
  const scores = artistScores();
  const max = Math.max(1, ...scores.values());
  return candidates
    .map((t, i) => {
      const affinity = (scores.get(mainArtist(t).toLowerCase()) || 0) / max;
      const fresh = playedRecently(t.id, 2) ? -0.4 : 0.2;
      const skips = skipCount(t.id) * 0.7;
      const keepOrder = -i * 0.01; // the source's own order still matters a bit
      return { t, s: affinity + fresh - skips + keepOrder + Math.random() * 0.15 };
    })
    .filter((x) => skipCount(x.t.id) < 3)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.t);
}

export const hasHistory = () => events.length >= 3;
