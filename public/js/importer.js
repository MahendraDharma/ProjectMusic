// Import a playlist from another app. The personal server reads the public playlist
// (YouTube Music, Spotify, Apple Music, Deezer) or a pasted song list, then finds every
// song on YouTube Music. Only titles and artists are read; nothing is copied from those apps.
import { h, icon, fmt, toast } from './ui.js';
import { t } from './i18n.js';
import { playlists } from './store.js';
import * as ytmusic from './sources/ytmusic.js';

export const PLATFORMS = [
  ['youtube', 'YouTube Music', '#FF0033'],
  ['spotify', 'Spotify', '#1ED760'],
  ['apple', 'Apple Music', '#FA2D48'],
  ['deezer', 'Deezer', '#A238FF'],
];
const platformName = (key) => (PLATFORMS.find((p) => p[0] === key) || [])[1] || t('textList');

const MAX = 1000;
const WORKERS = 4;

/* ---------- Pasted text, CSV and M3U ---------- */
function csvRows(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',' || c === ';' || c === '\t') { row.push(cell); cell = ''; } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}

function fromCsv(text) {
  const rows = csvRows(text);
  const head = (rows[0] || []).map((x) => x.trim().toLowerCase());
  const col = (re) => head.findIndex((x) => re.test(x));
  const ti = col(/^(track name|track|title|song|song name|name)$/);
  const ai = col(/artist/);
  if (ti < 0) return null;
  const di = col(/duration|length/);
  return rows.slice(1).map((r) => {
    let dur = di >= 0 ? parseFloat(r[di]) || 0 : 0;
    if (dur > 10000) dur /= 1000; // Exportify gives milliseconds
    return { title: (r[ti] || '').trim(), artist: ai >= 0 ? (r[ai] || '').replace(/\s*,\s*/g, ', ').trim() : '', duration: Math.round(dur) };
  });
}

function fromLine(line) {
  line = line.replace(/^\s*(\d+[.)]|\d+\s+-|[-*•])\s+/, '').trim();
  if (!line) return null;
  let m = line.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (m) return { artist: m[1].trim(), title: m[2].trim(), duration: 0 };
  m = line.match(/^(.+?)\s+by\s+(.+)$/i);
  if (m) return { title: m[1].trim(), artist: m[2].trim(), duration: 0 };
  return { title: line, artist: '', duration: 0 };
}

export function parseSongList(text) {
  text = (text || '').replace(/^\uFEFF/, '');
  const first = text.split(/\r?\n/, 1)[0].toLowerCase();
  let songs = null;
  if (/(title|track|song|name)/.test(first) && /[,;\t]/.test(first)) songs = fromCsv(text);
  if (!songs) {
    songs = [];
    let dur = 0;
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      const inf = line.match(/^#EXTINF:\s*(-?\d+)[^,]*,(.*)$/i);
      if (inf) { dur = Math.max(0, +inf[1]); const s = fromLine(inf[2]); if (s) songs.push({ ...s, duration: dur }); continue; }
      if (!line || line.startsWith('#') || /^(\w:\\|\/|file:|https?:)/i.test(line) || /\.(mp3|m4a|flac|wav|ogg|aac)$/i.test(line)) continue;
      const s = fromLine(line);
      if (s) songs.push(s);
    }
  }
  return songs.filter((s) => s && s.title).slice(0, MAX);
}

/* ---------- Page ---------- */
export function renderImport(view, { server, artEl, go, serverNotice, back }) {
  let run = null; // AbortController of the running import

  const urlInput = h('input', { class: 'text-input', type: 'url', inputmode: 'url', id: 'import-url', autocomplete: 'off', spellcheck: 'false', placeholder: t('linkPlaceholder') });
  const textInput = h('textarea', { class: 'text-input area', id: 'import-text', rows: 5, spellcheck: 'false', placeholder: 'Hindia - Evaluasi\nTulus - Hati-Hati di Jalan\nNadin Amizah - Bertaut' });
  const fileInput = h('input', { type: 'file', accept: '.csv,.txt,.m3u,.m3u8,text/csv,text/plain', hidden: true });
  const out = h('div', { class: 'import-out', 'aria-live': 'polite' });

  const startLink = async () => {
    const url = urlInput.value.trim();
    if (!url) { urlInput.focus(); return; }
    stop();
    run = new AbortController();
    const signal = run.signal;
    out.replaceChildren(h('div', { class: 'import-status' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), t('reading')));
    try {
      const list = await ytmusic.importList(url, signal);
      if (!signal.aborted) process({ ...list, sourceUrl: url }, signal);
    } catch (err) {
      if (err.name !== 'AbortError') out.replaceChildren(h('p', { class: 'import-error' }, err.message || t('loadFailed')));
    }
  };

  const startText = () => {
    const songs = parseSongList(textInput.value);
    if (!songs.length) { out.replaceChildren(h('p', { class: 'import-error' }, t('noTracksInText'))); return; }
    stop();
    run = new AbortController();
    process({ source: 'text', name: t('yourPlaylist'), cover: '', tracks: songs, matched: false }, run.signal);
  };

  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    textInput.value = (await f.text()).slice(0, 2_000_000);
    fileInput.value = '';
    startText();
  });
  urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') startLink(); });

  function stop() {
    run?.abort();
    run = null;
  }
  window.addEventListener('hashchange', stop, { once: true });

  /* Match each song on YouTube Music, a few at a time, keeping the original order. */
  async function process(list, signal) {
    const total = list.tracks.length;
    const found = new Array(total).fill(undefined);
    const rows = list.tracks.map((s) => h('div', { class: 'row import-row wait' },
      h('span', { class: 'row-art art-ph' }, icon('note', 18)),
      h('span', { class: 'row-text' }, h('b', {}, s.title), h('small', {}, [s.artist, s.duration ? fmt(s.duration) : null].filter(Boolean).join(' · ')))));
    const bar = h('span', { class: 'import-bar-fill' });
    const status = h('p', { class: 'import-progress-text' });
    const stopBtn = h('button', { class: 'btn small', onclick: () => { stop(); finish(true); } }, t('stop'));
    const actions = h('div', { class: 'import-actions' }, stopBtn);
    const cover = list.cover ? h('img', { class: 'import-cover', src: list.cover, alt: '', referrerpolicy: 'no-referrer' }) : h('span', { class: 'import-cover art-ph' }, icon('note', 30));
    out.replaceChildren(
      h('div', { class: 'import-head' }, cover,
        h('div', { class: 'row-text' }, h('small', {}, t('fromSource', { s: platformName(list.source) })), h('b', {}, list.name), h('small', {}, t('songs', { n: total })))),
      h('div', { class: 'import-bar', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': total }, bar),
      status, actions,
      h('div', { class: 'rows import-rows' }, rows));

    let done = 0;
    const paint = () => {
      status.textContent = t('matching', { done, total });
      bar.style.width = (total ? (done / total) * 100 : 100) + '%';
      bar.parentNode.setAttribute('aria-valuenow', done);
    };
    const show = (i, tr) => {
      const row = rows[i];
      row.classList.remove('wait');
      if (!tr) { row.classList.add('miss'); return; }
      row.replaceChildren(artEl(tr, 'row-art'), h('span', { class: 'row-text' }, h('b', {}, tr.title), h('small', {}, [tr.artist, tr.duration ? fmt(tr.duration) : null].filter(Boolean).join(' · '))),
        h('span', { class: 'import-ok', 'aria-label': 'OK' }, icon('check', 18)));
    };

    if (list.matched) {
      list.tracks.forEach((tr, i) => { found[i] = tr; show(i, tr); });
      done = total;
      paint();
      return finish(false);
    }
    paint();
    let next = 0;
    const worker = async () => {
      while (next < total && !signal.aborted) {
        const i = next++;
        let tr = null;
        for (let attempt = 0; attempt < 2 && !signal.aborted; attempt++) {
          try { tr = await ytmusic.match(list.tracks[i], signal); break; } catch (err) { if (err.name === 'AbortError') return; }
        }
        if (signal.aborted) return;
        // Keep the name the person knows from the other app; play the YouTube Music audio.
        const want = list.tracks[i];
        if (tr) tr = { ...tr, title: want.title || tr.title, artist: want.artist || tr.artist, duration: tr.duration || want.duration || 0 };
        found[i] = tr;
        show(i, tr);
        done++;
        paint();
      }
    };
    await Promise.all(Array.from({ length: Math.min(WORKERS, total) }, worker));
    if (!signal.aborted) finish(false);

    function finish(stopped) {
      const matched = found.filter(Boolean);
      const missing = list.tracks.filter((_, i) => found[i] === null);
      status.textContent = t('matchedOf', { found: matched.length, total });
      rows.forEach((r) => r.classList.remove('wait'));
      rows.forEach((r, i) => { if (found[i] === undefined) r.classList.add('skipped'); });
      const name = h('input', { class: 'text-input', id: 'import-name', value: list.name, autocomplete: 'off' });
      const save = () => {
        if (!matched.length) return;
        const pl = playlists.create({ name: name.value, tracks: matched, cover: list.cover || '', source: list.source, sourceUrl: list.sourceUrl || '' });
        toast(t('saved'));
        go('#/mine?id=' + encodeURIComponent(pl.id));
      };
      actions.replaceChildren(
        h('label', { class: 'small-label', for: 'import-name' }, t('playlistName')), name,
        h('div', { class: 'row-actions' },
          h('button', { class: 'btn primary', disabled: !matched.length, onclick: save }, icon('check', 18), t('savePlaylist')),
          matched.length ? h('button', { class: 'btn', onclick: () => back.play(matched) }, icon('play', 18), t('play')) : null));
      if (missing.length) {
        actions.append(h('h3', { class: 'label' }, t('notFoundTitle', { n: missing.length })), h('p', { class: 'hint sub' }, t('notFoundHint')),
          h('div', { class: 'chips wrap' }, missing.slice(0, 60).map((s) =>
            h('a', { class: 'chip', href: '#/search?q=' + encodeURIComponent([s.artist.split(',')[0], s.title].filter(Boolean).join(' ')) }, s.title))));
      }
      if (stopped) run = null;
    }
  }

  const head = h('header', { class: 'page-head' },
    h('button', { class: 'icon-btn', 'aria-label': t('back'), onclick: back.go }, icon('back', 22)),
    h('h1', {}, t('importPlaylist')));

  view.replaceChildren(...[
    head,
    h('p', { class: 'hint import-intro' }, t('importHint')),
    h('div', { class: 'import-platforms', 'aria-label': t('importWorksWith') },
      PLATFORMS.map(([, label, color]) => h('span', { class: 'platform' }, h('span', { class: 'platform-dot', style: { background: color } }), label))),
    server ? null : h('div', { class: 'import-need' }, h('p', { class: 'hint' }, t('importNeedServer')), serverNotice()),
    h('div', { class: 'panel-card import-card' },
      h('label', { class: 'small-label first', for: 'import-url' }, t('pasteLink')),
      h('div', { class: 'import-line' }, urlInput, h('button', { class: 'btn primary', disabled: !server, onclick: startLink }, t('importBtn')))),
    h('details', { class: 'panel-card import-card import-text' },
      h('summary', {}, t('orPasteList')),
      h('p', { class: 'hint sub' }, t('pasteListHint')),
      h('label', { class: 'small-label', for: 'import-text' }, t('textList')), textInput, fileInput,
      h('div', { class: 'row-actions' },
        h('button', { class: 'btn primary', disabled: !server, onclick: startText }, icon('search', 18), t('findSongs')),
        h('button', { class: 'btn', onclick: () => fileInput.click() }, icon('folder', 18), t('openFile')))),
    out,
  ].filter(Boolean));
  if (!('ontouchstart' in window) && server) urlInput.focus();
}
