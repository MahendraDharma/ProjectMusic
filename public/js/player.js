// Playback engine: queue, shuffle, repeat, Media Session (lock-screen controls) and a
// crossfade — the end of a song fades out while the next one fades in.
// Two <audio> elements take turns: `audio` is the one you hear, `standby` preloads the next.
import { history, persistable, load, save } from './store.js';

const TICK = 50; // ms between volume steps while fading

// iOS Safari ignores audio.volume (the hardware buttons own it), so a crossfade there would
// mean two songs at full volume. Detect that and fall back to a clean cut.
function volumeWorks() {
  const a = new Audio();
  a.volume = 0.5;
  return Math.abs(a.volume - 0.5) < 0.01;
}

class Player extends EventTarget {
  constructor() {
    super();
    this.audio = this._makeAudio();
    this.standby = this._makeAudio();
    this.queue = [];
    this.order = [];
    this.pos = -1;
    this.shuffle = false;
    this.repeat = 'off'; // 'off' | 'all' | 'one'
    this.fadeSeconds = 6;
    this.stopAfterCurrent = false; // sleep timer "end of song"
    this._volume = 1;
    this._fade = null;
    this._errors = 0;
    this._listened = 0;
    this._lastTime = 0;
    this.canFade = volumeWorks();
    this.resolve = (t) => t.streamUrl; // set by app.js (e.g. personal server address)
    this.prepare = () => {}; // set by app.js: let the server look up an upcoming song early
    this._preloaded = null; // id of the song already loading in `standby`
    this._endedFor = null; // id of the song whose end was already handled
    this._stuck = { t: -1, since: 0 };
    // End-of-song watchdog: if the music stops moving in the last seconds (a stalled
    // stream) or the browser never fires "ended", move on anyway.
    setInterval(() => this._watchdog(), 1000);
    this._bindMediaSession();
    this._restore();
  }

  /* ---------- State ---------- */
  get current() {
    return this.pos >= 0 ? this.queue[this.order[this.pos]] : null;
  }
  get playing() {
    return !this.audio.paused;
  }
  /** True while a song should be playing but no sound has arrived yet. */
  get loading() {
    const a = this.audio;
    return !!a.getAttribute('src') && !a.paused && a.readyState < 3;
  }
  /**
   * Length of the current song in seconds. Safari sometimes misreads streamed audio
   * (e.g. a 4:50 song shown as 9:39), so when the catalogue length disagrees clearly
   * with what the browser reports, trust the catalogue.
   */
  get duration() {
    const d = this.audio.duration;
    const known = this.current?.duration || 0;
    const ok = Number.isFinite(d) && d > 0;
    // Only when the browser says *longer*: a shorter file still ends on its own.
    if (known > 0 && (!ok || d - known > Math.max(8, known * 0.15))) return known;
    return ok ? d : 0;
  }
  get volume() {
    return this._volume;
  }
  set volume(v) {
    this._volume = Math.max(0, Math.min(1, v));
    if (!this._fade) this.audio.volume = this._volume;
  }
  upcoming() {
    return this.order.slice(this.pos).map((i) => this.queue[i]);
  }
  get remaining() {
    return this.order.length - 1 - this.pos;
  }

  /* ---------- Controls ---------- */
  playList(tracks, start = 0) {
    this._cancelFade();
    this.queue = tracks.slice();
    this.order = tracks.map((_, i) => i);
    if (this.shuffle) this._shuffleOrder(start);
    this.pos = this.shuffle ? 0 : start;
    this._load(true);
  }

  toggle() {
    if (!this.current) return;
    if (!this.audio.getAttribute('src')) return this._load(true);
    if (this.audio.paused) this._play();
    else this.pause();
  }

  pause() {
    this._cancelFade();
    this.audio.pause();
  }

  next(auto = false) {
    if (!this.queue.length) return;
    this._cancelFade();
    if (auto && this.repeat === 'one') {
      this.audio.currentTime = 0;
      return this._play();
    }
    const p = this._nextPos(auto);
    if (p < 0) {
      this.audio.pause();
      this.audio.currentTime = 0;
      return this._emit('state');
    }
    this.pos = p;
    this._load(true);
  }

  prev() {
    if (!this.queue.length) return;
    this._cancelFade();
    if (this.audio.currentTime > 3 || this.pos === 0) {
      this.audio.currentTime = 0;
      return;
    }
    this.pos--;
    this._load(true);
  }

  seek(seconds) {
    if (!Number.isFinite(seconds)) return;
    this._cancelFade();
    this.audio.currentTime = Math.max(0, seconds);
  }

  jump(offset) {
    const p = this.pos + offset;
    if (p >= 0 && p < this.order.length) {
      this._cancelFade();
      this.pos = p;
      this._load(true);
    }
  }

  addToQueue(track) {
    this.queue.push(track);
    this.order.push(this.queue.length - 1);
    if (this.pos < 0) {
      this.pos = this.order.length - 1;
      this._load(true);
    }
    this._changed();
  }

  appendMany(tracks) {
    const known = new Set(this.queue.map((t) => t.id));
    for (const t of tracks) {
      if (known.has(t.id)) continue;
      known.add(t.id);
      this.queue.push(t);
      this.order.push(this.queue.length - 1);
    }
    this._changed();
  }

  playNext(track) {
    if (this.pos < 0) return this.addToQueue(track);
    this.queue.push(track);
    this.order.splice(this.pos + 1, 0, this.queue.length - 1);
    this._changed();
  }

  removeAt(offset) {
    if (offset <= 0) return;
    this.order.splice(this.pos + offset, 1);
    this._changed();
  }

  toggleShuffle() {
    const curIndex = this.order[this.pos];
    this.shuffle = !this.shuffle;
    if (this.shuffle) {
      this._shuffleOrder(curIndex);
      this.pos = this.queue.length ? 0 : -1;
    } else {
      this.order = this.queue.map((_, i) => i);
      this.pos = curIndex ?? -1;
    }
    this._changed();
  }

  cycleRepeat() {
    this.repeat = { off: 'all', all: 'one', one: 'off' }[this.repeat];
    this._changed();
  }

  /** Set the src of the current song without playing (e.g. after the server connects). */
  refreshSource() {
    const t = this.current;
    if (!t || this.playing) return;
    this.audio.preload = 'metadata';
    this.audio.src = this.resolve(t);
  }

  /* ---------- Internals ---------- */
  _makeAudio() {
    const a = new Audio();
    a.preload = 'auto';
    a.addEventListener('play', () => a === this.audio && this._emit('state'));
    a.addEventListener('pause', () => a === this.audio && !this._fade && this._emit('state'));
    a.addEventListener('playing', () => {
      if (a !== this.audio) return;
      this._errors = 0;
      history.push(this.current);
      this._prepareNext();
    });
    a.addEventListener('ended', () => a === this.audio && this._onEnded());
    for (const ev of ['loadstart', 'waiting', 'play', 'playing', 'canplay', 'pause', 'error', 'emptied']) {
      a.addEventListener(ev, () => a === this.audio && this._emit('loading'));
    }
    a.addEventListener('loadedmetadata', () => a === this.audio && this._emit('time'));
    a.addEventListener('timeupdate', () => a === this.audio && this._onTime());
    a.addEventListener('error', () => {
      if (a !== this.audio || !a.getAttribute('src')) return;
      this._emit('error', { message: 'unplayable' });
      if (++this._errors < 3 && this.order.length > 1) setTimeout(() => this.next(true), 800);
    });
    return a;
  }

  _onTime() {
    const a = this.audio;
    const t = a.currentTime;
    if (t > this._lastTime && t - this._lastTime < 2) this._listened += t - this._lastTime;
    this._lastTime = t;
    this._emit('time');
    this._updatePosition();
    // Start the crossfade a few seconds before the end.
    const d = this.duration;
    const fade = this.fadeSeconds;
    // Start buffering the next song ~8 s before the fade, so it comes in without a gap.
    if (!this._fade && this.canFade && fade > 0 && Number.isFinite(d) && d - t <= fade + 8 && !a.paused
        && this.repeat !== 'one' && !this.stopAfterCurrent) {
      const p = this._nextPos(true);
      const nt = p >= 0 ? this.queue[this.order[p]] : null;
      if (nt && this._preloaded !== nt.id) {
        this._preloaded = nt.id;
        this.standby.preload = 'auto';
        this.standby.src = this.resolve(nt);
        this.standby.load();
      }
    }
    if (!this._fade && this.canFade && fade > 0 && Number.isFinite(d) && d > fade * 3
        && d - t <= fade && !a.paused && this.repeat !== 'one' && !this.stopAfterCurrent) {
      const p = this._nextPos(true);
      if (p >= 0) this._startFade(p, fade);
    }
  }

  _onEnded() {
    const id = this.current?.id;
    if (id && this._endedFor === id) return; // already handled (event + watchdog)
    this._endedFor = id;
    if (this.stopAfterCurrent) {
      this.stopAfterCurrent = false;
      this._emit('sleep');
      this._finishListen();
      this.pos = Math.min(this.pos + 1, this.order.length - 1);
      this._load(false);
      return;
    }
    this.next(true);
  }

  _nextPos(auto) {
    if (this.pos < this.order.length - 1) return this.pos + 1;
    if (this.repeat === 'all' || !auto) return 0;
    return -1;
  }

  _startFade(nextPos, seconds) {
    const from = this.audio;
    const to = this.standby;
    const nextTrack = this.queue[this.order[nextPos]];
    if (this._preloaded !== nextTrack.id || !to.getAttribute('src')) to.src = this.resolve(nextTrack);
    this._preloaded = null;
    this._endedFor = null;
    to.volume = 0;
    const startVol = this._volume;
    const steps = Math.max(1, Math.round((seconds * 1000) / TICK));
    let i = 0;
    const p = to.play();
    if (p && p.catch) p.catch(() => this._cancelFade());
    this._fade = { to, from, nextPos, timer: setInterval(() => {
      i++;
      const x = Math.min(1, i / steps);
      // equal-power curve sounds smoother than a straight line
      from.volume = startVol * Math.cos((x * Math.PI) / 2);
      to.volume = startVol * Math.sin((x * Math.PI) / 2);
      if (x >= 1) this._completeFade();
    }, TICK) };
    // Switch the "current" song right away so the UI shows what is coming in.
    this._finishListen();
    this.audio = to;
    this.standby = from;
    this.pos = nextPos;
    this._lastTime = to.currentTime;
    this._updateMediaSession();
    this._changed();
  }

  _completeFade() {
    const f = this._fade;
    if (!f) return;
    clearInterval(f.timer);
    this._fade = null;
    f.from.pause();
    f.from.removeAttribute('src');
    f.from.load();
    f.to.volume = this._volume;
    this._emit('state');
  }

  // Pause, seek or skip during a fade: finish the switch immediately.
  _cancelFade() {
    if (this._fade) this._completeFade();
  }

  _finishListen() {
    const t = this.current;
    if (t) this._emit('listened', { track: t, listened: this._listened, duration: this.duration || t.duration || 0 });
    this._listened = 0;
    this._lastTime = 0;
  }

  _shuffleOrder(firstIndex) {
    const rest = this.queue.map((_, i) => i).filter((i) => i !== firstIndex);
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    this.order = this.queue.length ? [firstIndex, ...rest] : [];
  }

  _watchdog() {
    const a = this.audio;
    const d = this.duration;
    if (this._fade || a.paused || d <= 0) return;
    // Past the real end (the browser thinks the song is longer): move on.
    if (a.currentTime > d + 1.5) { this._onEnded(); return; }
    // Only near the end: a stall in the middle is just slow network and should keep waiting.
    if (a.currentTime < d - 5) { this._stuck = { t: -1, since: 0 }; return; }
    if (a.currentTime !== this._stuck.t) { this._stuck = { t: a.currentTime, since: Date.now() }; return; }
    if (Date.now() - this._stuck.since > 3000) this._onEnded();
  }

  _prepareNext() {
    const p = this._nextPos(true);
    if (p >= 0) this.prepare(this.queue[this.order[p]]);
  }

  _load(autoplay) {
    const t = this.current;
    if (!t) return;
    this._finishListen();
    this._endedFor = null;
    this._stuck = { t: -1, since: 0 };
    if (this._preloaded && this._preloaded !== t.id) this._preloaded = null;
    this.audio.src = this.resolve(t);
    this.audio.volume = this._volume;
    this._updateMediaSession();
    this._changed();
    if (autoplay) this._play();
  }

  _play() {
    const p = this.audio.play();
    if (p && p.catch) {
      p.catch((err) => {
        if (err.name !== 'AbortError' && err.name !== 'NotAllowedError') this._emit('error', { message: 'unplayable' });
        this._emit('state');
      });
    }
  }

  _bindMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const set = (action, fn) => {
      try { navigator.mediaSession.setActionHandler(action, fn); } catch { /* unsupported */ }
    };
    set('play', () => this._play());
    set('pause', () => this.pause());
    set('previoustrack', () => this.prev());
    set('nexttrack', () => this.next());
    set('seekto', (e) => this.seek(e.seekTime));
    set('seekbackward', (e) => this.seek(this.audio.currentTime - (e.seekOffset || 10)));
    set('seekforward', (e) => this.seek(this.audio.currentTime + (e.seekOffset || 10)));
  }

  _updateMediaSession() {
    if (!('mediaSession' in navigator) || !window.MediaMetadata) return;
    const t = this.current;
    if (!t) return;
    const artwork = t.artworkLarge
      ? [{ src: t.artworkLarge, sizes: '512x512', type: 'image/jpeg' }]
      : [{ src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }];
    navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.artist, artwork });
  }

  _updatePosition() {
    const a = this.audio;
    if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
    const d = this.duration;
    if (d <= 0) return;
    const now = Date.now();
    if (now - (this._lastPos || 0) < 5000) return;
    this._lastPos = now;
    try {
      navigator.mediaSession.setPositionState({ duration: d, position: Math.min(a.currentTime, d), playbackRate: a.playbackRate });
    } catch { /* ignore */ }
  }

  _changed() {
    this._persist();
    this._emit('queue');
    this._emit('state');
  }

  _persist() {
    const keep = this.order.map((i) => this.queue[i]).filter(persistable);
    const cur = this.current;
    const at = persistable(cur) ? keep.indexOf(cur) : -1;
    save('queue', { tracks: keep.slice(0, 200), at, shuffle: this.shuffle, repeat: this.repeat });
  }

  _restore() {
    const q = load('queue', null);
    if (!q || !Array.isArray(q.tracks)) return;
    this.repeat = q.repeat || 'off';
    this.shuffle = !!q.shuffle;
    this.queue = q.tracks;
    this.order = q.tracks.map((_, i) => i);
    this.pos = q.tracks.length ? Math.max(0, Math.min(q.at, q.tracks.length - 1)) : -1;
    if (this.current) this._updateMediaSession();
  }

  _emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}

export const player = new Player();
