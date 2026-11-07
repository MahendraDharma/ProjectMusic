// UI utama: router berbasis hash (#/...), render tiap halaman, dan sambungan ke player.
// Sengaja tanpa framework agar file kecil dan cepat di HP lama.
import { player } from './player.js';
import { favs, history as recents, prefs } from './store.js';
import * as audius from './sources/audius.js';
import * as local from './sources/local.js';
import * as ytmusic from './sources/ytmusic.js';

// Diisi saat start: info server pribadi kalau halaman dibuka dari server ProjectMusic.
let server = null;

const $ = (id) => document.getElementById(id);
const view = $('view');
// Ganti isi halaman; elemen kosong (null/false) dilewati.
const show = (...nodes) => view.replaceChildren(...nodes.filter(Boolean));

/* ---------- Helper DOM (tanpa innerHTML → aman dari XSS) ---------- */
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
function icon(name) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'ic');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', '#i-' + name);
  svg.append(use);
  return svg;
}
function setIcon(btn, name) {
  btn.querySelector('use').setAttribute('href', '#i-' + name);
}

function fmt(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  sec = Math.floor(sec);
  const m = Math.floor(sec / 60);
  const s = String(sec % 60).padStart(2, '0');
  return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

/* ---------- Daftar lagu ---------- */
function artEl(track, large = false) {
  const src = large && !prefs.get('dataSaver') ? track.artworkLarge : track.artwork;
  if (!src) return h('span', { class: 'art-ph' }, icon('note'));
  return h('img', { src, alt: '', loading: 'lazy', decoding: 'async', width: 48, height: 48 });
}

function trackList(tracks, { onPlay, onRemove } = {}) {
  if (!tracks.length) return h('p', { class: 'state' }, 'Belum ada lagu.');
  const cur = player.current;
  return h('ul', { class: 'tracks' },
    tracks.map((t, i) => {
      const favBtn = t.ephemeral ? null : h('button', {
        class: 'icon-btn' + (favs.has(t.id) ? ' on' : ''),
        'aria-label': 'Favorit',
        onclick: (e) => {
          const on = favs.toggle(t);
          e.currentTarget.classList.toggle('on', on);
          setIcon(e.currentTarget, on ? 'heart' : 'heart-o');
          toast(on ? 'Ditambahkan ke Favorit' : 'Dihapus dari Favorit');
          syncNowPlaying();
        },
      }, icon(favs.has(t.id) ? 'heart' : 'heart-o'));

      const sideBtn = onRemove
        ? h('button', { class: 'icon-btn', 'aria-label': 'Hapus dari antrean', onclick: () => onRemove(i) }, icon('close'))
        : h('button', {
            class: 'icon-btn', 'aria-label': 'Tambah ke antrean',
            onclick: () => { player.addToQueue(t); toast('Ditambahkan ke antrean'); },
          }, icon('add'));

      return h('li', { class: 'track' + (cur && cur.id === t.id ? ' playing' : ''), 'data-id': t.id },
        h('button', { class: 'track-main', onclick: () => (onPlay ? onPlay(i) : player.playList(tracks, i)) },
          artEl(t),
          h('span', { class: 'track-text' }, h('b', {}, t.title), h('small', {}, t.artist)),
        ),
        t.duration ? h('span', { class: 'track-dur' }, fmt(t.duration)) : null,
        favBtn,
        sideBtn,
      );
    }),
  );
}

function loading() {
  return h('p', { class: 'state' }, 'Memuat…');
}
function errorState(err, retry) {
  return h('div', { class: 'state error' },
    h('p', {}, navigator.onLine ? 'Gagal memuat data. ' + (err?.message || '') : 'Kamu sedang offline.'),
    retry ? h('button', { class: 'btn', onclick: retry }, 'Coba lagi') : null,
  );
}

/* ---------- Komponen beranda ---------- */
function section(title, tracks, fullList) {
  const all = fullList || tracks;
  return h('section', {},
    h('div', { class: 'section-head' },
      h('h2', {}, title),
      h('button', { class: 'pill', onclick: () => player.playList(all, 0) }, 'Putar')),
    trackList(tracks, { onPlay: (i) => player.playList(all, i) }),
  );
}

function artistRow(artists) {
  return h('div', { class: 'artists' },
    artists.map((a) => h('a', { class: 'artist-card', href: '#/artist?id=' + encodeURIComponent(a.id) },
      a.artwork ? h('img', { src: a.artwork, alt: '', loading: 'lazy' }) : h('span', { class: 'art-ph' }, icon('note')),
      h('span', {}, a.name))));
}

/* ---------- Pengaturan server pribadi ---------- */
function serverSettings() {
  const input = h('input', {
    class: 'search-box', type: 'url', inputmode: 'url', autocomplete: 'off',
    placeholder: ytmusic.DEFAULT_SERVER, value: prefs.get('serverUrl') || '',
    'aria-label': 'Alamat server',
  });
  const status = h('p', { class: 'hint' }, server
    ? `✅ Tersambung ke server ProjectMusic ${server.version} di ${server.base} (YouTube Music, negara ${server.country}).`
    : '⚪ Server belum tersambung — sekarang hanya musik indie dari Audius.');
  const connect = async () => {
    prefs.set('serverUrl', ytmusic.normalizeBase(input.value));
    status.textContent = 'Menghubungkan…';
    const info = await connectServer();
    toast(info ? 'Server tersambung' : 'Server tidak ditemukan');
  };
  return h('div', { class: 'setting-block' },
    h('h2', {}, 'Server pribadi (YouTube Music)'),
    status,
    h('p', { class: 'hint' }, 'Kosongkan untuk memakai alamat bawaan (localhost:8080). Panduan: docs/PANDUAN-SERVER.md di GitHub.'),
    input,
    h('div', { class: 'row-actions' }, h('button', { class: 'btn primary', onclick: connect }, 'Sambungkan ulang')),
  );
}

/* ---------- Halaman ---------- */
let pageAbort;

const pages = {
  async home() {
    if (!server) return pages.indie();
    const box = h('div', {}, loading());
    const recent = recents.all().filter((t) => t.source === 'ytmusic');

    const load = async () => {
      pageAbort?.abort();
      pageAbort = new AbortController();
      const signal = pageAbort.signal;
      box.replaceChildren(loading());
      try {
        const [data, radio] = await Promise.all([
          ytmusic.home(signal),
          // "Untukmu": radio dari lagu terakhir yang diputar, seperti Quick picks
          recent[0] ? ytmusic.next(recent[0].videoId, signal).catch(() => []) : [],
        ]);
        box.replaceChildren(...[
          radio.length ? section(`Karena kamu memutar ${recent[0].title}`, radio.slice(0, 10)) : null,
          data.artists?.length ? h('section', {}, h('h2', {}, 'Artis populer'), artistRow(data.artists)) : null,
          ...data.sections.map((sec) => section(sec.title, sec.tracks.slice(0, 20), sec.tracks)),
        ].filter(Boolean));
      } catch (err) {
        if (err.name !== 'AbortError') box.replaceChildren(errorState(err, load));
      }
    };

    show(
      recent.length ? h('section', {}, h('h2', {}, 'Terakhir diputar'), trackList(recent.slice(0, 4))) : null,
      box,
      h('p', { class: 'hint' }, h('a', { href: '#/indie' }, 'Jelajahi musik indie dari Audius →')),
    );
    load();
  },

  async indie() {
    let genre = sessionStorage.getItem('pm:genre') || '';
    const listBox = h('div', {}, loading());
    const chips = h('div', { class: 'chips' });

    const renderChips = () => {
      chips.replaceChildren(...['', ...audius.GENRES].map((g) =>
        h('button', {
          class: 'chip' + (g === genre ? ' active' : ''),
          onclick: () => { genre = g; sessionStorage.setItem('pm:genre', g); renderChips(); loadList(); },
        }, g || 'Semua')));
    };

    const loadList = async () => {
      pageAbort?.abort();
      pageAbort = new AbortController();
      listBox.replaceChildren(loading());
      try {
        const tracks = await audius.trending({ genre }, pageAbort.signal);
        listBox.replaceChildren(trackList(tracks));
      } catch (err) {
        if (err.name !== 'AbortError') listBox.replaceChildren(errorState(err, loadList));
      }
    };

    const recent = recents.all().slice(0, 5);
    show(
      recent.length ? h('section', {}, h('h2', {}, 'Terakhir diputar'), trackList(recent)) : null,
      h('h1', {}, 'Trending minggu ini'),
      chips,
      listBox,
      h('p', { class: 'hint' }, 'Musik disediakan oleh Audius — platform musik terbuka tempat musisi independen membagikan karyanya secara gratis.'),
    );
    renderChips();
    loadList();
  },

  async search(params) {
    const q = params.get('q') || '';
    const input = h('input', {
      class: 'search-box', type: 'search', placeholder: 'Cari lagu atau artis…',
      value: q, enterkeyhint: 'search', autocomplete: 'off', 'aria-label': 'Cari',
    });
    const results = h('div', {});

    let timer;
    const run = async (term) => {
      pageAbort?.abort();
      if (!term.trim()) {
        results.replaceChildren(h('p', { class: 'state' }, 'Ketik judul lagu atau nama artis.'));
        return;
      }
      pageAbort = new AbortController();
      results.replaceChildren(loading());
      try {
        if (server) {
          const data = await ytmusic.search(term.trim(), pageAbort.signal);
          results.replaceChildren(...[
            data.artists.length ? artistRow(data.artists) : null,
            data.tracks.length ? trackList(data.tracks) : h('p', { class: 'state' }, 'Tidak ada hasil.'),
          ].filter(Boolean));
        } else {
          const tracks = await audius.search(term.trim(), pageAbort.signal);
          results.replaceChildren(tracks.length ? trackList(tracks) : h('p', { class: 'state' }, 'Tidak ada hasil.'));
        }
      } catch (err) {
        if (err.name !== 'AbortError') results.replaceChildren(errorState(err, () => run(term)));
      }
    };

    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        // Simpan kata kunci di URL tanpa memicu render ulang.
        window.history.replaceState(null, '', '#/search' + (input.value ? '?q=' + encodeURIComponent(input.value) : ''));
        run(input.value);
      }, 400);
    });

    show(h('h1', {}, 'Cari'), input, results);
    run(q);
    if (!q) input.focus();
  },

  async artist(params) {
    const id = params.get('id');
    if (!server || !id) return pages.home();
    show(loading());
    pageAbort?.abort();
    pageAbort = new AbortController();
    try {
      const a = await ytmusic.artist(id, pageAbort.signal);
      show(
        h('div', { class: 'artist-hero' },
          a.artwork ? h('img', { src: a.artwork, alt: '' }) : null,
          h('div', {}, h('h1', {}, a.name || 'Artis'), h('span', { class: 'badge' }, `${a.tracks.length} lagu`))),
        a.tracks.length
          ? h('div', { class: 'row-actions' },
              h('button', { class: 'btn primary', onclick: () => player.playList(a.tracks, 0) }, icon('play'), 'Putar'),
              h('button', { class: 'btn', onclick: () => { if (!player.shuffle) player.toggleShuffle(); player.playList(a.tracks, Math.floor(Math.random() * a.tracks.length)); } }, icon('shuffle'), 'Acak'))
          : null,
        trackList(a.tracks),
      );
    } catch (err) {
      if (err.name !== 'AbortError') show(errorState(err, render));
    }
  },

  async playlist(params) {
    const id = params.get('id');
    if (!server || !id) return pages.home();
    show(loading());
    pageAbort?.abort();
    pageAbort = new AbortController();
    try {
      const pl = await ytmusic.playlist(id, pageAbort.signal);
      show(
        h('h1', {}, pl.title || 'Playlist'),
        h('div', { class: 'row-actions' },
          h('button', { class: 'btn primary', onclick: () => player.playList(pl.tracks, 0) }, icon('play'), 'Putar semua')),
        trackList(pl.tracks),
      );
    } catch (err) {
      if (err.name !== 'AbortError') show(errorState(err, render));
    }
  },

  library() {
    const favorites = favs.all();
    const recent = recents.all();
    show(
      h('h1', {}, 'Koleksi'),
      h('h2', {}, `Favorit (${favorites.length})`),
      favorites.length
        ? h('div', { class: 'row-actions' },
            h('button', { class: 'btn primary', onclick: () => player.playList(favorites, 0) }, icon('play'), 'Putar semua'))
        : null,
      favorites.length ? trackList(favorites) : h('p', { class: 'hint' }, 'Tekan ♥ pada lagu untuk menyimpannya di sini.'),
      h('h2', {}, 'Riwayat'),
      recent.length
        ? h('div', { class: 'row-actions' },
            h('button', { class: 'btn', onclick: () => { recents.clear(); render(); } }, 'Hapus riwayat'))
        : null,
      trackList(recent),
      h('h2', {}, 'Pengaturan'),
      h('label', { class: 'setting' },
        h('span', {}, 'Hemat data', h('small', {}, 'Pakai gambar sampul ukuran kecil.')),
        h('input', {
          type: 'checkbox', checked: prefs.get('dataSaver'),
          onchange: (e) => { prefs.set('dataSaver', e.target.checked); syncNowPlaying(); },
        }),
      ),
      h('label', { class: 'setting' },
        h('span', {}, 'Radio otomatis', h('small', {}, 'Saat antrean hampir habis, tambahkan lagu yang mirip.')),
        h('input', {
          type: 'checkbox', checked: prefs.get('autoRadio') !== false,
          onchange: (e) => prefs.set('autoRadio', e.target.checked),
        }),
      ),
      serverSettings(),
      h('p', { class: 'hint' }, 'Data favorit & riwayat hanya disimpan di browser ini.'),
    );
  },

  local() {
    const picker = h('input', {
      type: 'file', accept: 'audio/*', multiple: true, hidden: true,
      onchange: (e) => {
        const tracks = local.fromFiles(e.target.files);
        if (!tracks.length) return toast('Tidak ada file audio yang dikenali.');
        localTracks = [...localTracks, ...tracks];
        render();
      },
    });
    show(
      h('h1', {}, 'Musik lokal'),
      h('p', { class: 'hint' }, 'Putar file musik dari HP/komputermu. File tidak diunggah ke mana pun.'),
      h('div', { class: 'row-actions' },
        h('button', { class: 'btn primary', onclick: () => picker.click() }, icon('folder'), 'Pilih file'),
        localTracks.length ? h('button', { class: 'btn', onclick: () => player.playList(localTracks, 0) }, icon('play'), 'Putar semua') : null,
      ),
      picker,
      trackList(localTracks),
    );
  },

  queue() {
    const up = player.upcoming();
    show(
      h('h1', {}, 'Antrean'),
      up.length
        ? trackList(up, {
            onPlay: (i) => player.jump(i),
            onRemove: (i) => (i === 0 ? toast('Lagu ini sedang diputar') : player.removeAt(i)),
          })
        : h('p', { class: 'state' }, 'Antrean kosong. Putar lagu dari Beranda atau Cari.'),
    );
  },
};

let localTracks = []; // hilang saat halaman ditutup (lihat sources/local.js)
let currentPage = '';

function render() {
  const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const name = pages[path] ? path : 'home';
  currentPage = name;
  const tab = { artist: 'search', playlist: 'home', indie: 'home' }[name] || name;
  document.querySelectorAll('.tabbar a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
  pages[name](new URLSearchParams(query));
}

/* ---------- Mini player & layar Sedang diputar ---------- */
const np = $('np');

function syncNowPlaying() {
  const t = player.current;
  $('mini').hidden = !t;
  if (!t) return;
  const small = t.artwork || 'icons/icon.svg';
  const large = (prefs.get('dataSaver') ? t.artwork : t.artworkLarge) || 'icons/icon.svg';
  if ($('mini-art').getAttribute('src') !== small) $('mini-art').src = small;
  if (!np.hidden && $('np-art').getAttribute('src') !== large) $('np-art').src = large;
  $('mini-title').textContent = $('np-title').textContent = t.title;
  $('mini-artist').textContent = $('np-artist').textContent = t.artist;
  document.title = `${t.title} · ${t.artist} — ProjectMusic`;

  const icn = player.playing ? 'pause' : 'play';
  setIcon($('mini-toggle'), icn);
  setIcon($('np-toggle'), icn);

  const fav = $('np-fav');
  fav.hidden = !!t.ephemeral;
  fav.classList.toggle('on', favs.has(t.id));
  setIcon(fav, favs.has(t.id) ? 'heart' : 'heart-o');

  $('np-shuffle').classList.toggle('on', player.shuffle);
  $('np-repeat').classList.toggle('on', player.repeat !== 'off');
  setIcon($('np-repeat'), player.repeat === 'one' ? 'repeat-one' : 'repeat');

  const src = $('np-source');
  src.replaceChildren(
    t.source === 'audius' && t.link ? h('a', { href: t.link, target: '_blank', rel: 'noopener' }, 'Lihat di Audius — dukung artisnya')
    : t.source === 'ytmusic' ? h('a', { href: t.link, target: '_blank', rel: 'noopener' }, 'Buka di YouTube Music')
    : t.source === 'local' ? 'File lokal' : '');

  const dl = $('np-download');
  dl.hidden = t.source !== 'ytmusic';
  if (!dl.hidden) dl.href = ytmusic.downloadUrl(t);
  $('np-lyrics-btn').hidden = !server || t.source === 'local';
  if (lyricsFor !== t.id) { lyricsFor = null; if (!$('np-lyrics').hidden) loadLyrics(); }

  // Tandai lagu yang sedang diputar di daftar yang terlihat.
  view.querySelectorAll('.track').forEach((li) => li.classList.toggle('playing', li.dataset.id === t.id));
}

let seeking = false;
function syncTime() {
  const a = player.audio;
  const dur = Number.isFinite(a.duration) ? a.duration : player.current?.duration || 0;
  const ratio = dur ? a.currentTime / dur : 0;
  $('mini-bar').style.width = (ratio * 100).toFixed(2) + '%';
  if (np.hidden) return;
  $('np-dur').textContent = fmt(dur);
  if (!seeking) {
    $('np-seek').value = Math.round(ratio * 1000);
    $('np-cur').textContent = fmt(a.currentTime);
  }
  highlightLyrics(a.currentTime);
}

/* ---------- Lirik (diambil saat dibutuhkan dari server pribadi) ---------- */
let lyricsFor = null;
let lyricLines = [];
let lyricIndex = -1;

async function loadLyrics() {
  const t = player.current;
  const box = $('np-lyrics');
  if (!t || !server) return;
  lyricsFor = t.id;
  lyricLines = [];
  lyricIndex = -1;
  box.className = 'lyrics';
  box.replaceChildren(h('p', {}, 'Mencari lirik…'));
  try {
    const data = await ytmusic.lyrics(t);
    if (lyricsFor !== t.id) return; // lagu sudah berganti
    const credit = data.source ? h('small', {}, 'Sumber lirik: ' + data.source) : null;
    if (data.synced?.length) {
      lyricLines = data.synced;
      box.replaceChildren(...data.synced.map((l, i) =>
        h('p', { 'data-i': i, onclick: () => player.seek(l.t) }, l.text || '♪')), credit || '');
    } else if (data.plain) {
      box.classList.add('plain');
      box.replaceChildren(data.plain, credit || '');
    } else {
      box.replaceChildren(h('p', {}, 'Lirik tidak ditemukan.'));
    }
  } catch {
    if (lyricsFor === t.id) box.replaceChildren(h('p', {}, 'Gagal memuat lirik.'));
  }
}

function highlightLyrics(time) {
  if (!lyricLines.length || $('np-lyrics').hidden) return;
  let i = lyricLines.length - 1;
  while (i >= 0 && lyricLines[i].t > time + 0.25) i--;
  if (i === lyricIndex) return;
  const box = $('np-lyrics');
  box.querySelector('p.now')?.classList.remove('now');
  lyricIndex = i;
  const el = i >= 0 && box.querySelector(`p[data-i="${i}"]`);
  if (el) {
    el.classList.add('now');
    box.scrollTo({ top: el.offsetTop - box.clientHeight / 3, behavior: 'smooth' });
  }
}

$('np-lyrics-btn').addEventListener('click', () => {
  const box = $('np-lyrics');
  box.hidden = !box.hidden;
  np.classList.toggle('show-lyrics', !box.hidden);
  $('np-lyrics-btn').classList.toggle('on', !box.hidden);
  if (!box.hidden && lyricsFor !== player.current?.id) loadLyrics();
});

/* ---------- Sleep timer ---------- */
const SLEEP_STEPS = [0, 15, 30, 60, -1]; // menit; -1 = setelah lagu ini selesai
let sleepStep = 0;
let sleepTimer = null;

function setSleep(step) {
  sleepStep = step;
  clearTimeout(sleepTimer);
  sleepTimer = null;
  const v = SLEEP_STEPS[step];
  const btn = $('np-sleep');
  btn.classList.toggle('on', v !== 0);
  btn.textContent = v === 0 ? 'Sleep: mati' : v === -1 ? 'Sleep: akhir lagu' : `Sleep: ${v} mnt`;
  if (v > 0) sleepTimer = setTimeout(() => { player.audio.pause(); setSleep(0); toast('Sleep timer: musik dihentikan'); }, v * 60000);
}
$('np-sleep').addEventListener('click', () => setSleep((sleepStep + 1) % SLEEP_STEPS.length));
player.audio.addEventListener('ended', () => {
  if (SLEEP_STEPS[sleepStep] === -1) {
    setSleep(0);
    // player otomatis lanjut ke lagu berikutnya; hentikan segera.
    setTimeout(() => player.audio.pause(), 0);
    toast('Sleep timer: musik dihentikan');
  }
});

/* ---------- Radio otomatis: antrean tidak pernah habis (seperti YouTube Music) ---------- */
let radioBusy = false;
async function fillRadio() {
  const t = player.current;
  if (!server || radioBusy || !t || t.source !== 'ytmusic' || prefs.get('autoRadio') === false) return;
  if (player.remaining > 2) return;
  radioBusy = true;
  try {
    const more = await ytmusic.next(t.videoId);
    if (more.length) player.appendMany(more.slice(0, 20));
  } catch { /* coba lagi di lagu berikutnya */ }
  finally { radioBusy = false; }
}

function openNowPlaying() {
  np.hidden = false;
  syncNowPlaying();
  syncTime();
}

$('mini-open').addEventListener('click', openNowPlaying);
$('np-close').addEventListener('click', () => { np.hidden = true; });
$('mini-toggle').addEventListener('click', () => player.toggle());
$('np-toggle').addEventListener('click', () => player.toggle());
$('mini-next').addEventListener('click', () => player.next());
$('np-next').addEventListener('click', () => player.next());
$('np-prev').addEventListener('click', () => player.prev());
$('np-shuffle').addEventListener('click', () => { player.toggleShuffle(); toast(player.shuffle ? 'Acak: aktif' : 'Acak: mati'); });
$('np-repeat').addEventListener('click', () => {
  player.cycleRepeat();
  toast({ off: 'Ulangi: mati', all: 'Ulangi: semua', one: 'Ulangi: satu lagu' }[player.repeat]);
});
$('np-fav').addEventListener('click', () => {
  const t = player.current;
  if (!t) return;
  toast(favs.toggle(t) ? 'Ditambahkan ke Favorit' : 'Dihapus dari Favorit');
  syncNowPlaying();
  if (currentPage === 'library') render();
});

const seek = $('np-seek');
seek.addEventListener('input', () => {
  seeking = true;
  const dur = player.audio.duration || 0;
  $('np-cur').textContent = fmt((seek.value / 1000) * dur);
});
seek.addEventListener('change', () => {
  player.seek((seek.value / 1000) * (player.audio.duration || 0));
  seeking = false;
});

// Pintasan keyboard di desktop
document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea')) return;
  if (e.code === 'Space') { e.preventDefault(); player.toggle(); }
  else if (e.key === 'ArrowRight' && e.shiftKey) player.next();
  else if (e.key === 'ArrowLeft' && e.shiftKey) player.prev();
  else if (e.key === 'Escape') np.hidden = true;
});

player.addEventListener('state', () => { syncNowPlaying(); fillRadio(); });
player.addEventListener('time', syncTime);
player.addEventListener('queue', () => { if (currentPage === 'queue') render(); });
player.addEventListener('error', (e) => {
  const t = player.current;
  toast(t && t.source === 'ytmusic' && !server
    ? 'Server ProjectMusic belum menyala — nyalakan server untuk lagu YouTube Music'
    : e.detail.message);
});

window.addEventListener('hashchange', () => { np.hidden = true; render(); view.focus({ preventScroll: true }); window.scrollTo(0, 0); });
window.addEventListener('offline', () => toast('Kamu sedang offline'));

// Lagu YouTube Music selalu diputar lewat alamat server yang sedang tersambung.
player.resolve = (t) => (t.source === 'ytmusic' ? ytmusic.streamUrl(t) : t.streamUrl);

async function connectServer() {
  server = await ytmusic.detect(prefs.get('serverUrl'));
  player.refreshSource();
  render();
  syncNowPlaying();
  return server;
}
connectServer();

// Service worker → aplikasi bisa di-"install" & dibuka lebih cepat (PWA).
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
