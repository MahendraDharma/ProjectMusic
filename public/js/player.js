// Mesin pemutar: satu elemen <audio>, antrean, acak (shuffle), ulangi (repeat),
// dan integrasi Media Session (kontrol di layar kunci / notifikasi HP).
import { history, persistable, load, save } from './store.js';

class Player extends EventTarget {
  constructor() {
    super();
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.queue = [];   // daftar lagu sesuai urutan asli
    this.order = [];   // urutan pemutaran (indeks ke queue) — diacak saat shuffle aktif
    this.pos = -1;     // posisi saat ini di dalam `order`
    this.shuffle = false;
    this.repeat = 'off'; // 'off' | 'all' | 'one'
    this._errors = 0;
    // Diisi app.js: menentukan URL audio sebenarnya (mis. alamat server pribadi).
    this.resolve = (t) => t.streamUrl;
    this._bindAudio();
    this._bindMediaSession();
    this._restore();
  }

  /* ---------- Info ---------- */
  get current() {
    return this.pos >= 0 ? this.queue[this.order[this.pos]] : null;
  }
  get playing() {
    return !this.audio.paused;
  }
  /** Lagu dalam urutan putar, mulai dari yang sedang diputar. */
  upcoming() {
    return this.order.slice(this.pos).map((i) => this.queue[i]);
  }

  /* ---------- Kontrol ---------- */
  /** Ganti antrean dengan `tracks` lalu putar dari `start`. */
  playList(tracks, start = 0) {
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
    else this.audio.pause();
  }

  next(auto = false) {
    if (!this.queue.length) return;
    if (auto && this.repeat === 'one') {
      this.audio.currentTime = 0;
      return this._play();
    }
    if (this.pos < this.order.length - 1) {
      this.pos++;
    } else if (this.repeat === 'all' || !auto) {
      this.pos = 0;
    } else {
      // Antrean habis
      this.audio.pause();
      this.audio.currentTime = 0;
      return this._emit('state');
    }
    this._load(true);
  }

  prev() {
    if (!this.queue.length) return;
    // Seperti pemutar pada umumnya: kalau sudah lewat 3 detik, ulang lagu ini dulu.
    if (this.audio.currentTime > 3 || this.pos === 0) {
      this.audio.currentTime = 0;
      return;
    }
    this.pos--;
    this._load(true);
  }

  seek(seconds) {
    if (Number.isFinite(seconds)) this.audio.currentTime = Math.max(0, seconds);
  }

  /** Lompat ke lagu ke-n di daftar `upcoming()`. */
  jump(offset) {
    const p = this.pos + offset;
    if (p >= 0 && p < this.order.length) {
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

  /** Tambah banyak lagu sekaligus di akhir antrean (dipakai radio otomatis). */
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

  /** Pasang ulang sumber audio lagu saat ini tanpa memutar (mis. setelah server tersambung). */
  refreshSource() {
    const t = this.current;
    if (!t || this.playing) return;
    this.audio.preload = 'metadata';
    this.audio.src = this.resolve(t);
  }

  /** Sisa lagu setelah yang sedang diputar. */
  get remaining() {
    return this.order.length - 1 - this.pos;
  }

  playNext(track) {
    if (this.pos < 0) return this.addToQueue(track);
    this.queue.push(track);
    this.order.splice(this.pos + 1, 0, this.queue.length - 1);
    this._changed();
  }

  removeAt(offset) {
    if (offset <= 0) return; // lagu yang sedang diputar tidak dihapus dari sini
    this.order.splice(this.pos + offset, 1);
    this._changed();
  }

  toggleShuffle() {
    this.shuffle = !this.shuffle;
    const curIndex = this.order[this.pos];
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

  /* ---------- Internal ---------- */
  _shuffleOrder(firstIndex) {
    const rest = this.queue.map((_, i) => i).filter((i) => i !== firstIndex);
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    this.order = this.queue.length ? [firstIndex, ...rest] : [];
  }

  _load(autoplay) {
    const t = this.current;
    if (!t) return;
    this.audio.src = this.resolve(t);
    this._updateMediaSession();
    this._changed();
    if (autoplay) this._play();
  }

  _play() {
    const p = this.audio.play();
    if (p && p.catch) {
      p.catch((err) => {
        // NotAllowedError: browser memblokir autoplay sebelum ada interaksi pengguna.
        if (err.name !== 'AbortError' && err.name !== 'NotAllowedError') {
          this._emit('error', { message: 'Gagal memutar lagu.' });
        }
        this._emit('state');
      });
    }
  }

  _bindAudio() {
    const a = this.audio;
    a.addEventListener('play', () => this._emit('state'));
    a.addEventListener('pause', () => this._emit('state'));
    a.addEventListener('playing', () => {
      this._errors = 0;
      history.push(this.current);
    });
    a.addEventListener('ended', () => this.next(true));
    a.addEventListener('loadedmetadata', () => this._emit('time'));
    a.addEventListener('timeupdate', () => {
      this._emit('time');
      this._updatePosition();
    });
    a.addEventListener('error', () => {
      if (!a.src) return;
      this._emit('error', { message: 'Lagu tidak bisa diputar, lanjut ke berikutnya.' });
      // Cegah loop tanpa akhir kalau semua lagu gagal (mis. sedang offline).
      if (++this._errors < 3 && this.order.length > 1) setTimeout(() => this.next(true), 800);
    });
  }

  _bindMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    const set = (action, fn) => {
      try { ms.setActionHandler(action, fn); } catch { /* aksi tidak didukung */ }
    };
    set('play', () => this._play());
    set('pause', () => this.audio.pause());
    set('previoustrack', () => this.prev());
    set('nexttrack', () => this.next());
    set('seekto', (e) => this.seek(e.seekTime));
    set('seekbackward', (e) => this.seek(this.audio.currentTime - (e.seekOffset || 10)));
    set('seekforward', (e) => this.seek(this.audio.currentTime + (e.seekOffset || 10)));
  }

  _updateMediaSession() {
    if (!('mediaSession' in navigator) || !window.MediaMetadata) return;
    const t = this.current;
    const artwork = t.artworkLarge
      ? [{ src: t.artworkLarge, sizes: '480x480', type: 'image/jpeg' }]
      : [{ src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }];
    navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.artist, artwork });
  }

  _updatePosition() {
    const a = this.audio;
    if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
    if (!Number.isFinite(a.duration) || a.duration <= 0) return;
    // Cukup diperbarui sesekali agar hemat CPU.
    const now = Date.now();
    if (now - (this._lastPos || 0) < 5000) return;
    this._lastPos = now;
    try {
      navigator.mediaSession.setPositionState({
        duration: a.duration, position: Math.min(a.currentTime, a.duration), playbackRate: a.playbackRate,
      });
    } catch { /* abaikan */ }
  }

  _changed() {
    this._persist();
    this._emit('queue');
    this._emit('state');
  }

  // Simpan antrean supaya saat aplikasi dibuka lagi, lagu terakhir masih ada (tanpa autoplay).
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
    // URL audio baru dipasang lewat refreshSource() setelah server terdeteksi.
    if (this.current) this._updateMediaSession();
  }

  _emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}

export const player = new Player();
