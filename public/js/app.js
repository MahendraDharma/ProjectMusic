// ProjectMusic app shell: routing, pages, mini player / desktop bar, Now Playing,
// lyrics, song menu, share cards and settings. Plain DOM, no framework.
import { player } from './player.js';
import { favs, history as recents, prefs, recentSearches, persistable } from './store.js';
import { t, lang } from './i18n.js';
import { h, icon, setIcon, logo, fmt, toast, openSheet, closeSheet, skeletonRows, skeletonCards } from './ui.js';
import * as audius from './sources/audius.js';
import * as local from './sources/local.js';
import * as ytmusic from './sources/ytmusic.js';
import * as taste from './taste.js';

const $ = (id) => document.getElementById(id);
const view = $('view');
const isDesktop = () => window.matchMedia('(min-width: 1024px)').matches;

let server = null; // info about the personal server, when connected
let localTracks = [];
let pageAbort = null;
let currentRoute = 'home';
let mixPreset = null;

/* =====================================================================
   Helpers
   ===================================================================== */
function show(...nodes) {
  view.replaceChildren(...nodes.flat(Infinity).filter(Boolean));
}

function greeting() {
  const hr = new Date().getHours();
  return t(hr < 11 ? 'goodMorning' : hr < 15 ? 'goodAfternoon' : hr < 19 ? 'goodEvening' : 'goodNight');
}

function art(track, large = false) {
  if (!track) return '';
  return (large && !prefs.get('dataSaver') ? track.artworkLarge : track.artwork) || track.artwork || '';
}

function artEl(track, cls = 'art', large = false) {
  const src = art(track, large);
  if (!src) return h('span', { class: cls + ' art-ph' }, icon('note', 20));
  return h('img', { class: cls, src, alt: '', loading: 'lazy', decoding: 'async' });
}

function abortable() {
  pageAbort?.abort();
  pageAbort = new AbortController();
  return pageAbort.signal;
}

function errorState(err, retry) {
  return h('div', { class: 'state' },
    h('p', {}, navigator.onLine ? t('loadFailed') : t('offline')),
    retry ? h('button', { class: 'btn', onclick: retry }, t('retry')) : null);
}

function emptyState(title, text, action) {
  return h('div', { class: 'state' }, h('p', { class: 'state-title' }, title), text ? h('p', {}, text) : null, action || null);
}

function sectionHead(title, action) {
  return h('div', { class: 'section-head' }, h('h2', {}, title), action || null);
}

/* =====================================================================
   Song rows, cards, artists
   ===================================================================== */
function isCurrent(track) {
  const c = player.current;
  return !!(c && track && c.id === track.id);
}

function trackRow(track, list, index, { onPlay, onRemove, number } = {}) {
  const play = () => (onPlay ? onPlay(index) : player.playList(list, index));
  return h('div', { class: 'row' + (isCurrent(track) ? ' playing' : ''), dataset: { id: track.id } },
    number ? h('span', { class: 'row-num' }, index + 1) : null,
    h('button', { class: 'row-main', onclick: play },
      artEl(track, 'row-art'),
      h('span', { class: 'row-text' },
        h('b', {}, track.title),
        h('small', {}, [track.artist, track.duration ? fmt(track.duration) : null].filter(Boolean).join(' · ')))),
    onRemove
      ? h('button', { class: 'icon-btn', 'aria-label': t('remove'), onclick: () => onRemove(index) }, icon('close', 20))
      : h('button', { class: 'icon-btn', 'aria-label': t('moreOptions'), onclick: () => songSheet(track) }, icon('more', 22)));
}

function trackList(tracks, opts) {
  return h('div', { class: 'rows' }, tracks.map((tr, i) => trackRow(tr, tracks, i, opts)));
}

function trackCard(track, list, index) {
  return h('button', { class: 'card', onclick: () => player.playList(list, index) },
    artEl(track, 'card-art', true),
    h('b', {}, track.title),
    h('small', {}, track.artist));
}

function cardRow(tracks) {
  return h('div', { class: 'cards' }, tracks.map((tr, i) => trackCard(tr, tracks, i)));
}

function artistCard(a) {
  const img = a.artwork ? h('img', { class: 'artist-art', src: a.artwork, alt: '', loading: 'lazy' }) : h('span', { class: 'artist-art art-ph' }, (a.name || '?')[0]);
  const href = a.id ? '#/artist?id=' + encodeURIComponent(a.id) : '#/search?q=' + encodeURIComponent(a.name);
  return h('a', { class: 'artist', href }, img, h('b', {}, a.name), h('small', {}, t('artist')));
}

function artistRow(list) {
  return h('div', { class: 'cards artists' }, list.map(artistCard));
}

/* =====================================================================
   Song menu (bottom sheet)
   ===================================================================== */
function songSheet(track) {
  const liked = favs.has(track.id);
  const act = (ic, label, fn, visible = true) => visible && h('button', { class: 'sheet-act', onclick: () => { closeSheet(); fn(); } }, icon(ic), h('span', {}, label));
  openSheet([
    h('div', { class: 'sheet-head' }, artEl(track, 'row-art'), h('span', { class: 'row-text' }, h('b', {}, track.title), h('small', {}, track.artist))),
    act('playNext', t('playNext'), () => { player.playNext(track); toast(t('playingNext')); }),
    act('addQueue', t('addToQueue'), () => { player.addToQueue(track); toast(t('addedToQueue')); }),
    act(liked ? 'heartFill' : 'heart', liked ? t('removeLiked') : t('addLiked'), () => toggleLike(track), persistable(track)),
    act('radio', t('startRadio'), () => startRadio(track), !!(server && track.source === 'ytmusic')),
    act('user', t('goToArtist'), () => go('#/search?q=' + encodeURIComponent(track.artist.split(',')[0])), track.source !== 'local'),
    act('mix', t('mixWith'), () => { mixPreset = { A: player.current && player.current.id !== track.id ? player.current : null, B: track }; go('#/mix'); }),
    act('share', t('share'), () => openSharePreview('song', [], track), track.source !== 'local'),
    act('download', t('download'), () => downloadTrack(track), !!(server && track.source === 'ytmusic')),
  ], { label: t('moreOptions') });
}

function toggleLike(track) {
  const on = favs.toggle(track);
  toast(on ? t('addedLiked') : t('removedLiked'));
  syncPlayer();
  renderSideStatus();
  if (currentRoute === 'library') render();
}

function downloadTrack(track) {
  const a = h('a', { href: ytmusic.downloadUrl(track), download: '' });
  document.body.append(a);
  a.click();
  a.remove();
  toast(t('downloadStarted'));
}

async function startRadio(track) {
  try {
    const more = taste.rank(await ytmusic.next(track.videoId));
    player.playList([track, ...more.slice(0, 25)], 0);
    toast(t('radioStarted'));
  } catch {
    toast(t('loadFailed'));
  }
}

function quickGrid(list) {
  return h('div', { class: 'quick' }, list.map((tr, i) => h('button', { class: 'quick-item', onclick: () => player.playList(list, i) },
    artEl(tr, 'quick-art'), h('span', {}, tr.title))));
}

function homeHead(title, withLogo) {
  return h('header', { class: 'page-head home-head' },
    withLogo ? h('span', { class: 'only-mobile brand-logo' }, logo(32)) : null,
    h('h1', {}, title),
    h('a', { class: 'icon-btn only-mobile', href: '#/settings', 'aria-label': t('settings') }, icon('settings', 22)));
}

/* =====================================================================
   Pages
   ===================================================================== */
const pages = {
  async home() {
    if (!server) return pages.indie(true);
    const signal = abortable();
    const recent = recents.all();
    const madeBox = h('div', {});
    const chartBox = h('div', {}, sectionHead(t('trendingWeek')), skeletonCards(4), skeletonRows(3));
    const radioBox = h('div', {});

    show(homeHead(greeting(), true), recent.length ? quickGrid(recent.slice(0, 6)) : null, madeBox, chartBox, radioBox);

    // Made for you + your top artists, from the on-device taste model
    const tops = taste.topArtists(6);
    if (tops.length) {
      madeBox.replaceChildren(sectionHead(t('madeForYou')), skeletonCards(4));
      const seeds = tops.filter((a) => a.seed.source === 'ytmusic' && a.seed.videoId).slice(0, 3);
      Promise.all(seeds.map((a) => ytmusic.next(a.seed.videoId, signal).catch(() => [])))
        .then((lists) => {
          const merged = [];
          for (let i = 0; i < 12; i++) for (const l of lists) if (l[i] && !merged.some((m) => m.id === l[i].id)) merged.push(l[i]);
          const picks = taste.rank(merged).slice(0, 12);
          madeBox.replaceChildren(...[
            picks.length ? h('section', {}, sectionHead(t('madeForYou'), h('button', { class: 'link-btn', onclick: () => player.playList(picks, 0) }, t('playAll'))),
              h('p', { class: 'hint sub' }, t('madeForYouHint')), cardRow(picks)) : null,
            h('section', {}, sectionHead(t('yourTopArtists')), artistRow(tops.map((a) => ({ name: a.name, artwork: a.seed.artwork })))),
          ].filter(Boolean));
        })
        .catch(() => madeBox.replaceChildren());
    }

    try {
      const data = await ytmusic.home(signal);
      const nodes = [];
      data.sections.forEach((sec, i) => {
        nodes.push(h('section', {}, sectionHead(sec.title, h('a', { class: 'link-btn', href: '#/playlist?id=' + encodeURIComponent(sec.playlistId) }, t('seeAll'))),
          cardRow(sec.tracks.slice(0, 20))));
        if (i === 0 && data.artists?.length) nodes.push(h('section', {}, sectionHead(t('popularArtists')), artistRow(data.artists.slice(0, 12))));
      });
      chartBox.replaceChildren(...nodes);
    } catch (err) {
      if (err.name !== 'AbortError') chartBox.replaceChildren(errorState(err, render));
    }

    const seed = recent.find((tr) => tr.source === 'ytmusic');
    if (seed) {
      try {
        const radio = taste.rank(await ytmusic.next(seed.videoId, signal)).slice(0, 5);
        if (radio.length) radioBox.replaceChildren(h('section', {},
          h('div', { class: 'section-head' }, h('h2', {}, t('becauseYouPlayed'), h('br'), h('span', { class: 'sub' }, seed.title)),
            h('button', { class: 'pill accent', onclick: () => player.playList([seed, ...radio], 0) }, icon('play', 16), t('play'))),
          trackList(radio)));
      } catch { /* optional section */ }
    }
  },

  async indie(isHome = false) {
    let genre = sessionStorage.getItem('pm:genre') || '';
    const listBox = h('div', {}, skeletonCards(4), skeletonRows(6));
    const chips = h('div', { class: 'chips scroll' });
    const quick = recents.all().slice(0, 6);
    const renderChips = () => chips.replaceChildren(...['', ...audius.GENRES].map((g) =>
      h('button', { class: 'chip' + (g === genre ? ' on' : ''), 'aria-pressed': String(g === genre), onclick: () => { genre = g; sessionStorage.setItem('pm:genre', g); renderChips(); load(); } }, g || t('all'))));
    const load = async () => {
      listBox.replaceChildren(skeletonCards(4), skeletonRows(6));
      try {
        const tracks = await audius.trending({ genre }, abortable());
        listBox.replaceChildren(cardRow(tracks.slice(0, 10)), trackList(tracks.slice(10)));
      } catch (err) {
        if (err.name !== 'AbortError') listBox.replaceChildren(errorState(err, load));
      }
    };
    show(
      homeHead(isHome ? greeting() : t('browseAudius'), isHome),
      isHome && quick.length ? quickGrid(quick) : null,
      isHome ? serverOffNotice() : null,
      sectionHead(t('trendingWeek')), chips, listBox,
      h('p', { class: 'hint' }, t('audiusCredit')),
    );
    renderChips();
    load();
  },

  search(params) {
    const q = params.get('q') || '';
    const input = h('input', { class: 'field-input', type: 'search', placeholder: t('searchPlaceholder'), value: q, enterkeyhint: 'search', autocomplete: 'off', 'aria-label': t('search') });
    const results = h('div', {});
    let timer;
    let saveTimer;

    const browse = () => {
      const tiles = [
        ['browsePop', 'pop indonesia', '#4a2b34'], ['browseDangdut', 'dangdut koplo', '#4a3a22'], ['browseGalau', 'lagu galau', '#24324a'],
        ['browseChill', 'santai akustik', '#22423a'], ['browseIndie', 'indie indonesia', '#3a2a4a'], ['browseAudius', null, '#34363b'],
      ];
      const recentList = recentSearches.all();
      return [
        recentList.length ? h('h3', { class: 'label' }, t('recentSearches')) : null,
        ...recentList.map((r) => h('div', { class: 'recent' },
          h('button', { class: 'recent-main', onclick: () => { input.value = r; run(r); } }, icon('clock', 20), h('span', {}, r)),
          h('button', { class: 'icon-btn', 'aria-label': t('remove'), onclick: () => { recentSearches.remove(r); results.replaceChildren(...browse().filter(Boolean)); } }, icon('close', 18)))),
        h('h3', { class: 'label' }, t('browse')),
        h('div', { class: 'tiles' }, tiles.map(([key, query, bg]) => query
          ? h('button', { class: 'tile', style: { background: bg }, onclick: () => { input.value = t(key); run(query); } }, t(key))
          : h('a', { class: 'tile', style: { background: bg }, href: '#/indie' }, t(key)))),
      ];
    };

    const run = async (term) => {
      clearTimeout(saveTimer);
      const query = term.trim();
      window.history.replaceState(null, '', '#/search' + (query ? '?q=' + encodeURIComponent(query) : ''));
      if (!query) { pageAbort?.abort(); results.replaceChildren(...browse().filter(Boolean)); return; }
      const signal = abortable();
      results.replaceChildren(skeletonRows(6));
      try {
        if (server) {
          const data = await ytmusic.search(query, signal);
          results.replaceChildren(...[
            data.artists.length ? artistRow(data.artists) : null,
            data.tracks.length ? trackList(data.tracks, { onPlay: (i) => { recentSearches.add(query); player.playList(data.tracks, i); } })
              : emptyState(t('noResults', { q: query }), t('tryArtist')),
          ].filter(Boolean));
          if (data.tracks.length) saveTimer = setTimeout(() => recentSearches.add(query), 1500);
        } else {
          const tracks = await audius.search(query, signal);
          results.replaceChildren(tracks.length ? trackList(tracks) : emptyState(t('noResults', { q: query }), t('tryArtist')));
          if (tracks.length) saveTimer = setTimeout(() => recentSearches.add(query), 1500);
        }
      } catch (err) {
        if (err.name !== 'AbortError') results.replaceChildren(errorState(err, () => run(query)));
      }
    };
    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => run(input.value), 350); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(timer); run(input.value); recentSearches.add(input.value); } });

    show(h('header', { class: 'page-head' }, h('h1', { class: 'big' }, t('search'))),
      h('label', { class: 'field' }, icon('search', 20), input), results);
    run(q);
    if (!q && !('ontouchstart' in window)) input.focus();
  },

  library(params) {
    const filter = params.get('f') || 'all';
    const chips = h('div', { class: 'chips' }, [['all', 'all'], ['liked', 'liked'], ['history', 'history'], ['local', 'localFiles']].map(([k, label]) =>
      h('a', { class: 'chip' + (filter === k ? ' on' : ''), href: '#/library' + (k === 'all' ? '' : '?f=' + k), 'aria-current': filter === k ? 'page' : null }, t(label))));
    const head = h('header', { class: 'page-head' }, h('h1', { class: 'big' }, t('library')),
      h('a', { class: 'icon-btn only-mobile', href: '#/settings', 'aria-label': t('settings') }, icon('settings', 22)));

    if (filter === 'liked') {
      const list = favs.all();
      return show(head, chips,
        list.length ? [h('div', { class: 'row-actions' }, h('button', { class: 'btn primary', onclick: () => player.playList(list, 0) }, icon('play', 18), t('playAll'))), trackList(list)]
          : emptyState(t('noLiked'), t('noLikedHint')));
    }
    if (filter === 'history') {
      const list = recents.all();
      return show(head, chips,
        list.length ? [h('div', { class: 'row-actions' }, h('button', { class: 'btn', onclick: () => { recents.clear(); render(); } }, t('clearHistory'))), trackList(list)]
          : emptyState(t('noHistory'), t('noHistoryHint')));
    }
    if (filter === 'local') {
      return show(head, chips,
        h('p', { class: 'hint' }, t('filesStayHere')),
        h('div', { class: 'row-actions' },
          h('button', { class: 'btn primary', onclick: () => $('file-input').click() }, icon('folder', 18), t('pickFilesBtn')),
          localTracks.length ? h('button', { class: 'btn', onclick: () => player.playList(localTracks, 0) }, icon('play', 18), t('playAll')) : null),
        localTracks.length ? trackList(localTracks) : emptyState(t('noFiles'), t('pickFiles')));
    }

    const tops = taste.topArtists(4);
    const libRow = (ic, cls, title, sub, href) => h('a', { class: 'lib-row', href }, h('span', { class: 'lib-ic ' + cls }, icon(ic, 26)), h('span', { class: 'row-text' }, h('b', {}, title), h('small', {}, sub)));
    show(head, chips,
      libRow('heartFill', 'fav', t('likedSongs'), t('songs', { n: favs.all().length }), '#/library?f=liked'),
      libRow('clock', '', t('recentlyPlayed'), t('songs', { n: recents.all().length }), '#/library?f=history'),
      libRow('folder', '', t('filesOnDevice'), t('pickFiles'), '#/library?f=local'),
      tops.length ? h('h3', { class: 'label' }, t('yourTopArtists')) : null,
      tops.map((a) => h('a', { class: 'lib-row', href: '#/search?q=' + encodeURIComponent(a.name) },
        a.seed.artwork ? h('img', { class: 'lib-ic round', src: a.seed.artwork, alt: '' }) : h('span', { class: 'lib-ic round' }, a.name[0]),
        h('span', { class: 'row-text' }, h('b', {}, a.name), h('small', {}, t('artist'))))),
      serverCard());
  },

  settings() {
    const input = h('input', { class: 'text-input', type: 'url', inputmode: 'url', id: 'server-url', autocomplete: 'off', placeholder: ytmusic.DEFAULT_SERVER, value: prefs.get('serverUrl') || '' });
    const toggle = (key, label, hint, onChange) => {
      const on = !!prefs.get(key);
      return h('button', { class: 'setting', role: 'switch', 'aria-checked': String(on), onclick: (e) => {
        const v = !prefs.get(key);
        prefs.set(key, v);
        e.currentTarget.setAttribute('aria-checked', String(v));
        onChange?.(v);
      } }, h('span', { class: 'row-text' }, h('b', {}, label), h('small', {}, hint)), h('span', { class: 'switch', 'aria-hidden': 'true' }, h('span', {})));
    };
    const fadeLabel = h('b', { class: 'fade-val' });
    const fadeVal = () => (prefs.get('fade') > 0 ? t('seconds', { n: prefs.get('fade') }) : t('crossfadeOff'));
    fadeLabel.textContent = fadeVal();
    const fade = h('input', { type: 'range', min: 0, max: 12, step: 1, value: prefs.get('fade'), class: 'wide-range', 'aria-label': t('crossfade') });
    fade.addEventListener('input', () => { prefs.set('fade', +fade.value); player.fadeSeconds = +fade.value; fadeLabel.textContent = fadeVal(); });

    show(
      h('header', { class: 'page-head' }, h('button', { class: 'icon-btn', 'aria-label': t('back'), onclick: () => (history.length > 1 ? history.back() : go('#/')) }, icon('back', 22)), h('h1', {}, t('settings'))),
      h('h3', { class: 'label caps' }, t('serverAddress')),
      h('div', { class: 'panel-card' }, serverStatusLine(),
        h('label', { class: 'small-label', for: 'server-url' }, t('serverAddress')), input,
        h('div', { class: 'row-actions' }, h('button', { class: 'btn primary', onclick: async () => {
          prefs.set('serverUrl', ytmusic.normalizeBase(input.value));
          const info = await connectServer();
          toast(info ? t('connected') : t('notFound'));
        } }, t('reconnect')),
          h('a', { class: 'btn', href: 'get/' }, icon('download', 18), t('setupGuide')))),
      h('h3', { class: 'label caps' }, t('playback')),
      h('div', { class: 'panel-card list' },
        h('div', { class: 'setting static' }, h('span', { class: 'row-text' }, h('b', {}, t('crossfade')), h('small', {}, player.canFade ? t('crossfadeHint') : t('crossfadeIos'))), fadeLabel),
        h('div', { class: 'setting static' }, fade),
        toggle('autoRadio', t('autoRadio'), t('autoRadioHint'))),
      h('h3', { class: 'label caps' }, t('display')),
      h('div', { class: 'panel-card list' },
        toggle('glass', t('glass'), t('glassHint'), applyGlass),
        toggle('dataSaver', t('dataSaver'), t('dataSaverHint'), () => syncPlayer())),
      h('h3', { class: 'label caps' }, t('language')),
      h('div', { class: 'chips' }, [['en', 'English'], ['id', 'Bahasa Indonesia']].map(([k, label]) =>
        h('button', { class: 'chip' + (lang() === k ? ' on' : ''), 'aria-pressed': String(lang() === k), onclick: () => { prefs.set('lang', k); document.documentElement.lang = k; buildChrome(); render(); toast(t('languageSet')); } }, label))),
      h('h3', { class: 'label caps' }, t('about')),
      h('div', { class: 'panel-card list' },
        h('button', { class: 'setting', onclick: () => { taste.reset(); toast(t('resetTasteDone')); } }, h('span', { class: 'row-text' }, h('b', {}, t('resetTaste')))),
        h('a', { class: 'setting', href: 'https://github.com/MahendraDharma/ProjectMusic', target: '_blank', rel: 'noopener' },
          h('span', { class: 'row-text' }, h('b', {}, 'ProjectMusic'), h('small', {}, 'github.com/MahendraDharma/ProjectMusic')), icon('forward', 20))),
    );
  },

  async artist(params) {
    const id = params.get('id');
    if (!server || !id) return pages.home();
    show(skeletonRows(8));
    try {
      const a = await ytmusic.artist(id, abortable());
      show(
        h('div', { class: 'hero' }, a.artwork ? h('img', { class: 'hero-art', src: a.artwork, alt: '' }) : null,
          h('div', {}, h('h1', {}, a.name), h('p', { class: 'hint' }, t('songs', { n: a.tracks.length })))),
        h('div', { class: 'row-actions' },
          h('button', { class: 'btn primary', onclick: () => player.playList(a.tracks, 0) }, icon('play', 18), t('play')),
          h('button', { class: 'btn', onclick: () => { if (!player.shuffle) player.toggleShuffle(); player.playList(a.tracks, Math.floor(Math.random() * a.tracks.length)); } }, icon('shuffle', 18), t('shuffle'))),
        trackList(a.tracks));
    } catch (err) {
      if (err.name !== 'AbortError') show(errorState(err, render));
    }
  },

  async playlist(params) {
    const id = params.get('id');
    if (!server || !id) return pages.home();
    show(skeletonRows(8));
    try {
      const pl = await ytmusic.playlist(id, abortable());
      show(h('header', { class: 'page-head' }, h('h1', {}, pl.title || '')),
        h('div', { class: 'row-actions' }, h('button', { class: 'btn primary', onclick: () => player.playList(pl.tracks, 0) }, icon('play', 18), t('playAll'))),
        trackList(pl.tracks, { number: true }));
    } catch (err) {
      if (err.name !== 'AbortError') show(errorState(err, render));
    }
  },

  async mix() {
    pageAbort?.abort();
    const { renderMix } = await import('./mix.js');
    const preset = mixPreset || { A: player.current };
    mixPreset = null;
    renderMix(view, {
      preset,
      resolve: (tr) => player.resolve(tr),
      pauseMain: () => { if (player.playing) { player.pause(); toast(t('mixMainPaused')); } },
      pickTrack: pickTrackSheet,
    });
  },
};

function pickTrackSheet(onPick) {
  const input = h('input', { class: 'field-input', type: 'search', placeholder: t('searchPlaceholder'), 'aria-label': t('search') });
  const list = h('div', { class: 'rows pick-list' });
  const fill = (tracks) => list.replaceChildren(...tracks.map((tr) => h('button', { class: 'row-main pick', onclick: () => { closeSheet(); onPick(tr); } },
    artEl(tr, 'row-art'), h('span', { class: 'row-text' }, h('b', {}, tr.title), h('small', {}, tr.artist)))));
  const base = [...player.upcoming(), ...favs.all(), ...recents.all()].filter((v, i, a) => a.findIndex((x) => x.id === v.id) === i).slice(0, 30);
  fill(base);
  let timer;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const q = input.value.trim();
      if (!q) return fill(base);
      try { fill(server ? (await ytmusic.search(q)).tracks : await audius.search(q)); } catch { /* keep list */ }
    }, 350);
  });
  openSheet([h('h2', { class: 'sheet-title' }, t('chooseSong')), h('label', { class: 'field' }, icon('search', 20), input), list], { label: t('chooseSong'), wide: true });
}

/* Safari (Mac) and every browser on iPhone/iPad use WebKit, which blocks a secure
   site like GitHub Pages from talking to http://localhost or a Wi-Fi address. The server
   may be running fine — the page just can't see it, so explain and offer a direct link. */
function webkitBlocksServer() {
  if (location.protocol !== 'https:') return false;
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const safari = /Safari/.test(ua) && !/Chrome|Chromium|Edg|Firefox|OPR/.test(ua);
  return ios ? 'ios' : safari ? 'safari' : false;
}

function serverOffNotice() {
  const blocked = webkitBlocksServer();
  if (!blocked) {
    return h('a', { class: 'notice', href: 'get/' }, h('span', { class: 'dot off' }),
      h('span', { class: 'row-text' }, h('b', {}, t('serverOff')), h('small', {}, t('serverOffHint'))));
  }
  const target = prefs.get('serverUrl') || ytmusic.DEFAULT_SERVER;
  return h('div', { class: 'notice safari' }, h('span', { class: 'dot warn' }),
    h('span', { class: 'row-text wrap' },
      h('b', {}, t('safariTitle')),
      h('small', {}, t(blocked === 'ios' ? 'safariIosHint' : 'safariHint')),
      h('span', { class: 'notice-actions' },
        blocked === 'ios'
          ? h('a', { class: 'btn primary small', href: '#/settings' }, t('safariSetAddress'))
          : h('a', { class: 'btn primary small', href: target }, t('safariOpen', { url: target.replace(/^https?:\/\//, '').replace(/\/$/, '') })),
        h('a', { class: 'btn small', href: 'get/' }, t('setupGuide')))));
}

function serverStatusLine() {
  return h('div', { class: 'status-line' }, h('span', { class: 'dot' + (server ? '' : ' off') }),
    h('b', {}, server ? `${t('serverConnected')} · YouTube Music` : t('serverOff')));
}

function serverCard() {
  return h('a', { class: 'server-card', href: server ? '#/settings' : 'get/' }, h('span', { class: 'dot' + (server ? '' : ' off') }),
    h('span', { class: 'row-text' }, h('b', {}, server ? t('serverConnected') : t('serverOff')),
      h('small', {}, server ? `${server.base.replace(/\/$/, '')} · YouTube Music` : t('serverOffHint'))));
}

/* =====================================================================
   Router
   ===================================================================== */
function go(hash) {
  if (location.hash === hash) render(); else location.hash = hash;
}

function render() {
  const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const name = pages[path] ? path : 'home';
  currentRoute = name;
  const tab = { artist: 'search', playlist: 'home', indie: 'home', settings: 'library' }[name] || name;
  document.querySelectorAll('[data-tab]').forEach((a) => {
    const on = a.dataset.tab === tab;
    a.classList.toggle('on', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  pages[name](new URLSearchParams(query));
  renderSideStatus();
}

/* =====================================================================
   Chrome: sidebar, tab bar, mini player, desktop bar
   ===================================================================== */
const navItems = [['home', '#/', 'home'], ['search', '#/search', 'search'], ['library', '#/library', 'library'], ['mix', '#/mix', 'mix']];

function buildChrome() {
  $('side').replaceChildren(
    h('a', { class: 'side-brand', href: '#/' }, logo(30), h('span', {}, 'ProjectMusic')),
    h('nav', { class: 'side-nav', 'aria-label': 'Main' }, navItems.map(([key, href, ic]) => h('a', { href, dataset: { tab: key } }, icon(ic, 22), t(key)))),
    h('p', { class: 'side-label' }, t('library')),
    h('a', { class: 'side-lib', href: '#/library?f=liked' }, h('span', { class: 'lib-ic fav' }, icon('heartFill', 20)), h('span', { class: 'row-text' }, h('b', {}, t('likedSongs')), h('small', { id: 'side-liked' }, ''))),
    h('a', { class: 'side-lib', href: '#/library?f=history' }, h('span', { class: 'lib-ic' }, icon('clock', 20)), h('span', { class: 'row-text' }, h('b', {}, t('recentlyPlayed')), h('small', { id: 'side-recent' }, ''))),
    h('a', { class: 'side-lib', href: '#/library?f=local' }, h('span', { class: 'lib-ic' }, icon('folder', 20)), h('span', { class: 'row-text' }, h('b', {}, t('filesOnDevice')), h('small', {}, t('dropFiles')))),
    h('div', { id: 'side-status', class: 'side-status' }),
    h('a', { class: 'side-settings', href: '#/settings' }, icon('settings', 20), t('settings')),
  );
  $('tabbar').replaceChildren(...navItems.slice(0, 3).map(([key, href, ic]) => h('a', { href, dataset: { tab: key } }, icon(ic, 24), h('span', {}, t(key)))));
  buildMini();
  buildBar();
  buildNowPlaying();
  buildPanel();
  lastTrackId = null;
  syncPlayer();
  syncTime();
}

function renderSideStatus() {
  $('side-status')?.replaceChildren(serverCard());
  const liked = $('side-liked');
  if (liked) liked.textContent = t('songs', { n: favs.all().length });
  const rec = $('side-recent');
  if (rec) rec.textContent = t('songs', { n: recents.all().length });
}

let mini = {};
function buildMini() {
  mini = {
    art: h('img', { class: 'mini-art', alt: '' }),
    title: h('b', {}), artist: h('small', {}),
    like: h('button', { class: 'icon-btn', 'aria-label': t('addLiked'), onclick: () => player.current && toggleLike(player.current) }, icon('heart', 22)),
    play: h('button', { class: 'icon-btn ink', 'aria-label': t('play'), onclick: () => player.toggle() }, icon('play', 24)),
    bar: h('i', { class: 'mini-progress' }),
  };
  $('mini').replaceChildren(
    h('button', { class: 'mini-open', 'aria-label': t('nowPlayingLabel'), onclick: () => openNowPlaying() }, mini.art, h('span', { class: 'row-text' }, mini.title, mini.artist)),
    mini.like, mini.play, mini.bar);
}

let bar = {};
function buildBar() {
  bar = {
    art: h('img', { class: 'bar-art', alt: '' }),
    title: h('b', {}), artist: h('small', {}),
    like: h('button', { class: 'icon-btn', 'aria-label': t('addLiked'), onclick: () => player.current && toggleLike(player.current) }, icon('heart', 20)),
    shuffle: h('button', { class: 'icon-btn', 'aria-label': t('shuffle'), onclick: () => player.toggleShuffle() }, icon('shuffle', 18)),
    play: h('button', { class: 'play-sm', 'aria-label': t('play'), onclick: () => player.toggle() }, icon('play', 20)),
    repeat: h('button', { class: 'icon-btn', 'aria-label': t('repeatOff'), onclick: () => cycleRepeat() }, icon('repeat', 18)),
    cur: h('span', { class: 'time' }, '0:00'), dur: h('span', { class: 'time' }, '0:00'),
    seek: h('input', { type: 'range', min: 0, max: 1000, value: 0, class: 'seek', 'aria-label': t('nowPlayingLabel') }),
    lyrics: h('button', { class: 'icon-btn', 'aria-label': t('lyrics'), onclick: () => openNowPlaying('lyrics') }, icon('lyrics', 18)),
    queue: h('button', { class: 'icon-btn', 'aria-label': t('queue'), onclick: () => setPanel(panelTab === 'queue' ? 'lyrics' : 'queue') }, icon('queue', 18)),
    vol: h('input', { type: 'range', min: 0, max: 100, value: Math.round((prefs.get('volume') ?? 1) * 100), class: 'vol', 'aria-label': t('volume') }),
  };
  bindSeek(bar.seek, bar.cur);
  bar.vol.addEventListener('input', () => { player.volume = bar.vol.value / 100; prefs.set('volume', player.volume); });
  $('bar').replaceChildren(
    h('div', { class: 'bar-now' }, h('button', { class: 'bar-open', 'aria-label': t('nowPlayingLabel'), onclick: () => openNowPlaying() }, bar.art), h('span', { class: 'row-text' }, bar.title, bar.artist), bar.like),
    h('div', { class: 'bar-mid' },
      h('div', { class: 'bar-ctl' }, bar.shuffle,
        h('button', { class: 'icon-btn ink', 'aria-label': t('previous'), onclick: () => player.prev() }, icon('prev', 22)), bar.play,
        h('button', { class: 'icon-btn ink', 'aria-label': t('next'), onclick: () => player.next() }, icon('next', 22)), bar.repeat),
      h('div', { class: 'bar-seek' }, bar.cur, bar.seek, bar.dur)),
    h('div', { class: 'bar-right' }, bar.lyrics, bar.queue, icon('volume', 18), bar.vol));
}

function bindSeek(input, curLabel) {
  input.addEventListener('input', () => {
    input.dataset.seeking = '1';
    curLabel.textContent = fmt((input.value / 1000) * (player.audio.duration || 0));
    input.style.setProperty('--p', input.value / 10 + '%');
  });
  input.addEventListener('change', () => {
    player.seek((input.value / 1000) * (player.audio.duration || 0));
    delete input.dataset.seeking;
  });
}

function cycleRepeat() {
  player.cycleRepeat();
  toast({ off: t('repeatOff'), all: t('repeatAll'), one: t('repeatOne') }[player.repeat]);
}

/* =====================================================================
   Now Playing (full screen on phones, art + lyrics side by side on desktop)
   ===================================================================== */
let np = {};
let npMode = 'art'; // 'art' | 'lyrics' | 'queue'
const SLEEP = [0, 15, 30, 60, -1];
let sleepIdx = 0;
let sleepTimer = null;

function buildNowPlaying() {
  np = {
    root: $('np'),
    context: h('b', {}),
    art: h('img', { class: 'np-art', alt: '' }),
    title: h('h2', {}), artist: h('p', {}),
    like: h('button', { class: 'icon-btn', 'aria-label': t('addLiked'), onclick: () => player.current && toggleLike(player.current) }, icon('heart', 26)),
    seek: h('input', { type: 'range', min: 0, max: 1000, value: 0, class: 'seek', 'aria-label': t('nowPlayingLabel') }),
    cur: h('span', {}, '0:00'), dur: h('span', {}, '0:00'),
    shuffle: h('button', { class: 'icon-btn', 'aria-label': t('shuffle'), onclick: () => player.toggleShuffle() }, icon('shuffle', 22)),
    play: h('button', { class: 'play-lg', 'aria-label': t('play'), onclick: () => player.toggle() }, icon('play', 34)),
    repeat: h('button', { class: 'icon-btn', 'aria-label': t('repeatOff'), onclick: () => cycleRepeat() }, icon('repeat', 22)),
    lyricsChip: h('button', { class: 'chip-soft', onclick: () => setNpMode(npMode === 'lyrics' ? 'art' : 'lyrics') }, icon('lyrics', 18), t('lyrics')),
    sleepChip: h('button', { class: 'chip-soft', onclick: () => cycleSleep() }, icon('moon', 18), h('span', {}, t('sleep'))),
    queueChip: h('button', { class: 'chip-soft', onclick: () => setNpMode(npMode === 'queue' ? 'art' : 'queue') }, icon('queue', 18), t('queue')),
    lyrics: h('div', { class: 'lyrics' }),
    queue: h('div', { class: 'np-queue' }),
  };
  bindSeek(np.seek, np.cur);
  np.root.replaceChildren(
    h('div', { class: 'np-top' },
      h('button', { class: 'icon-btn ink', 'aria-label': t('close'), onclick: closeNowPlaying }, icon('down', 26)),
      h('div', { class: 'np-context' }, h('small', {}, t('playingFrom')), np.context),
      h('button', { class: 'icon-btn ink', 'aria-label': t('moreOptions'), onclick: () => player.current && songSheet(player.current) }, icon('more', 24))),
    h('div', { class: 'np-body' },
      h('div', { class: 'np-main' },
        h('div', { class: 'np-stage' }, np.art),
        h('div', { class: 'np-meta' }, h('div', { class: 'row-text' }, np.title, np.artist), np.like),
        np.seek, h('div', { class: 'np-times' }, np.cur, np.dur),
        h('div', { class: 'np-ctl' }, np.shuffle,
          h('button', { class: 'icon-btn ink big', 'aria-label': t('previous'), onclick: () => player.prev() }, icon('prev', 34)), np.play,
          h('button', { class: 'icon-btn ink big', 'aria-label': t('next'), onclick: () => player.next() }, icon('next', 34)), np.repeat),
        h('div', { class: 'np-foot' }, np.lyricsChip, np.sleepChip, np.queueChip,
          h('button', { class: 'chip-soft icon-only', 'aria-label': t('share'), onclick: () => openShareChooser() }, icon('share', 18)))),
      h('div', { class: 'np-side' },
        h('div', { class: 'np-side-head' },
          h('button', { class: 'chip-soft', dataset: { np: 'lyrics' }, onclick: () => setNpMode('lyrics') }, t('lyrics')),
          h('button', { class: 'chip-soft', dataset: { np: 'queue' }, onclick: () => setNpMode('queue') }, t('queue')),
          h('button', { class: 'chip-soft', onclick: () => openLyricsSelect() }, icon('share', 16), t('share'))),
        np.lyrics, np.queue)),
  );
  np.root.dataset.mode = npMode;
  syncSleepChip();
}

function openNowPlaying(mode) {
  if (!player.current) return;
  if (mode) npMode = mode; else if (isDesktop() && npMode === 'art') npMode = 'lyrics';
  np.root.hidden = false;
  document.body.classList.add('np-open');
  setNpMode(npMode);
  syncPlayer();
  syncTime();
}

function closeNowPlaying() {
  if (!np.root || np.root.hidden) return;
  np.root.hidden = true;
  document.body.classList.remove('np-open');
}

function setNpMode(mode) {
  npMode = mode;
  np.root.dataset.mode = mode;
  np.lyricsChip.classList.toggle('on', mode === 'lyrics');
  np.queueChip.classList.toggle('on', mode === 'queue');
  np.root.querySelectorAll('[data-np]').forEach((b) => b.classList.toggle('on', b.dataset.np === mode || (mode === 'art' && b.dataset.np === 'lyrics')));
  if (mode === 'lyrics' || (isDesktop() && mode === 'art')) ensureLyrics();
  if (mode === 'queue') renderQueue(np.queue);
}

function cycleSleep() {
  sleepIdx = (sleepIdx + 1) % SLEEP.length;
  clearTimeout(sleepTimer);
  player.stopAfterCurrent = false;
  const v = SLEEP[sleepIdx];
  if (v > 0) sleepTimer = setTimeout(() => { player.pause(); sleepIdx = 0; syncSleepChip(); toast(t('sleepDone')); }, v * 60000);
  if (v === -1) player.stopAfterCurrent = true;
  syncSleepChip();
  toast(v === 0 ? t('sleepOff') : t('sleepSet', { v: sleepLabel(v) }));
}
const sleepLabel = (v) => (v === -1 ? t('sleepEnd') : t('sleepMin', { n: v }));
function syncSleepChip() {
  const v = SLEEP[sleepIdx];
  np.sleepChip.lastChild.textContent = v === 0 ? t('sleep') : sleepLabel(v);
  np.sleepChip.classList.toggle('on', v !== 0);
}

/* ---------- Queue ---------- */
function renderQueue(container) {
  const up = player.upcoming();
  container.replaceChildren(
    h('p', { class: 'label' }, t('upNext')),
    up.length ? trackList(up, { onPlay: (i) => player.jump(i), onRemove: (i) => { if (i > 0) player.removeAt(i); } }) : h('p', { class: 'hint' }, t('queueEmpty')));
}

/* ---------- Desktop right panel ---------- */
let panelTab = 'queue';
const panel = {};
function buildPanel() {
  panel.tabs = h('div', { class: 'panel-tabs' },
    h('button', { class: 'chip-soft', dataset: { panel: 'queue' }, onclick: () => setPanel('queue') }, t('queue')),
    h('button', { class: 'chip-soft', dataset: { panel: 'lyrics' }, onclick: () => setPanel('lyrics') }, t('lyrics')),
    h('button', { class: 'icon-btn', 'aria-label': t('nowPlayingLabel'), onclick: () => openNowPlaying(panelTab === 'lyrics' ? 'lyrics' : 'queue') }, icon('expand', 18)));
  panel.art = h('img', { class: 'panel-art', alt: '' });
  panel.title = h('h3', {});
  panel.artist = h('p', { class: 'hint' });
  panel.body = h('div', { class: 'panel-body' });
  $('panel').replaceChildren(panel.tabs, panel.art, panel.title, panel.artist, panel.body);
  setPanel(panelTab);
}

function setPanel(tab) {
  panelTab = tab;
  panel.tabs.querySelectorAll('[data-panel]').forEach((b) => b.classList.toggle('on', b.dataset.panel === tab));
  bar.queue?.classList.toggle('on', tab === 'queue');
  if (tab === 'queue') renderQueue(panel.body);
  else { ensureLyrics(); panel.body.replaceChildren(lyricsNode()); }
}

/* =====================================================================
   Lyrics — fetched while a song plays from the personal server
   (LRCLIB / YouTube Music). Nothing is stored in the code.
   ===================================================================== */
const lyr = { forId: null, status: 'idle', lines: [], plain: '', source: '', index: -1 };

async function ensureLyrics() {
  const tr = player.current;
  if (!tr) return;
  if (lyr.forId === tr.id && lyr.status !== 'idle') return paintLyrics();
  lyr.forId = tr.id;
  lyr.lines = [];
  lyr.plain = '';
  lyr.index = -1;
  if (!server || tr.source === 'local') {
    lyr.status = 'noserver';
    return paintLyrics();
  }
  lyr.status = 'loading';
  paintLyrics();
  try {
    const data = await ytmusic.lyrics(tr);
    if (lyr.forId !== tr.id) return;
    lyr.lines = data.synced || [];
    lyr.plain = data.plain || '';
    lyr.source = data.source || '';
    lyr.status = lyr.lines.length || lyr.plain ? 'ok' : 'none';
  } catch {
    if (lyr.forId === tr.id) lyr.status = 'failed';
  }
  paintLyrics();
}

function lyricsNode() {
  const box = h('div', { class: 'lyrics-box' });
  const msg = { loading: t('lyricsLoading'), none: t('lyricsNone'), failed: t('lyricsFailed'), noserver: t('lyricsNeedServer'), idle: '' }[lyr.status];
  if (lyr.status !== 'ok') {
    box.append(h('p', { class: 'lyrics-msg' }, msg));
  } else if (lyr.lines.length) {
    box.append(...lyr.lines.map((l, i) => h('button', { class: 'lyric' + (i === lyr.index ? ' now' : i < lyr.index ? ' past' : ''), dataset: { i }, onclick: () => player.seek(l.t) }, l.text || '♪')),
      h('p', { class: 'lyrics-credit' }, t('lyricsSource', { s: lyr.source }), ' · ', t('tapToJump')));
  } else {
    box.append(h('p', { class: 'lyrics-plain' }, lyr.plain), h('p', { class: 'lyrics-credit' }, t('lyricsSource', { s: lyr.source })));
  }
  return box;
}

function paintLyrics() {
  np.lyrics.replaceChildren(lyricsNode());
  if (panelTab === 'lyrics') panel.body.replaceChildren(lyricsNode());
}

function highlightLyrics(time) {
  if (!lyr.lines.length || lyr.forId !== player.current?.id) return;
  let i = lyr.lines.length - 1;
  while (i >= 0 && lyr.lines[i].t > time + 0.25) i--;
  if (i === lyr.index) return;
  lyr.index = i;
  document.querySelectorAll('.lyrics-box').forEach((box) => {
    box.querySelectorAll('.lyric').forEach((el) => {
      const n = +el.dataset.i;
      el.classList.toggle('now', n === i);
      el.classList.toggle('past', n < i);
    });
    const cur = box.querySelector('.lyric.now');
    const scroller = box.parentElement;
    if (cur && scroller && scroller.offsetParent) {
      const offset = cur.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      scroller.scrollTo({ top: scroller.scrollTop + offset - scroller.clientHeight / 3, behavior: 'smooth' });
    }
  });
}

/* =====================================================================
   Share to Instagram — lyrics card = design A, song card = design E
   ===================================================================== */
function openShareChooser() {
  const tr = player.current;
  if (!tr) return;
  if (lyr.forId === tr.id && (lyr.lines.length || lyr.plain)) openLyricsSelect(); else openSharePreview('song', [], tr);
}

function openLyricsSelect() {
  const tr = player.current;
  if (!tr) return;
  if (lyr.forId !== tr.id || (!lyr.lines.length && !lyr.plain)) return openSharePreview('song', [], tr);
  const source = lyr.lines.length ? lyr.lines.map((l) => l.text).filter((x) => x && x !== '♪') : lyr.plain.split('\n').filter(Boolean);
  const picked = new Set();
  const status = h('p', { class: 'hint center' }, t('pickLines'));
  const nextBtn = h('button', { class: 'btn primary small', disabled: true, onclick: () => {
    const lines = [...picked].sort((a, b) => a - b).map((i) => source[i]);
    closeSheet();
    openSharePreview('lyrics', lines, tr);
  } }, t('next'));
  const items = source.map((text, i) => h('button', { class: 'pick-line', 'aria-pressed': 'false', onclick: (e) => {
    if (picked.has(i)) picked.delete(i);
    else if (picked.size >= 5) return toast(t('maxLines'));
    else picked.add(i);
    e.currentTarget.setAttribute('aria-pressed', String(picked.has(i)));
    status.textContent = picked.size ? t('linesSelected', { n: picked.size }) : t('pickLines');
    nextBtn.disabled = !picked.size;
  } }, text));
  openSheet([
    h('div', { class: 'sheet-bar' }, h('button', { class: 'link-btn', onclick: closeSheet }, t('cancel')), h('b', {}, t('selectLyrics')), nextBtn),
    status, h('div', { class: 'pick-lines' }, items),
    h('button', { class: 'btn wide', onclick: () => { closeSheet(); openSharePreview('song', [], tr); } }, icon('share', 18), t('songCard')),
  ], { label: t('selectLyrics'), wide: true });
}

async function artworkForCanvas(tr) {
  const { loadImage } = await import('./share.js');
  const src = art(tr, true);
  if (!src) return null;
  if (server && tr.source === 'ytmusic') return loadImage(ytmusic.imageUrl(tr.artworkLarge || tr.artwork));
  return loadImage(src);
}

async function openSharePreview(kind, lines, tr) {
  const share = await import('./share.js');
  const img = await artworkForCanvas(tr);
  const artPalette = share.paletteFrom(img ? share.dominantColor(img) : null);
  const swatches = [
    ['Artwork', artPalette], ['Pink', { top: '#ff375f', bottom: '#7a0f2a' }], ['Night', { top: '#22242a', bottom: '#0a0b0c' }],
    ['Sea', { top: '#4f8fbf', bottom: '#1d3557' }], ['Forest', { top: '#5d7f76', bottom: '#1f3a34' }],
  ];
  let mode = kind === 'lyrics' && lines.length ? 'lyrics' : 'song';
  let sw = 0;
  let blob = null;
  const preview = h('img', { class: 'share-preview', alt: '' });
  const busy = h('p', { class: 'hint center share-busy' }, t('making'));
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#FF375F';

  const draw = async () => {
    busy.hidden = false;
    const palette = swatches[sw][1];
    const position = player.audio.duration ? Math.min(0.95, player.audio.currentTime / player.audio.duration) : 0.4;
    const canvas = mode === 'lyrics'
      ? await share.lyricsCard({ track: tr, lines, img, palette, accent })
      : await share.songCard({ track: tr, img, palette, accent, position: position || 0.4 });
    blob = await share.canvasToBlob(canvas);
    if (preview.src) URL.revokeObjectURL(preview.src);
    preview.src = URL.createObjectURL(blob);
    busy.hidden = true;
  };
  const tabs = h('div', { class: 'chips center' },
    lines.length ? h('button', { class: 'chip' + (mode === 'lyrics' ? ' on' : ''), onclick: (e) => { mode = 'lyrics'; markTabs(e); draw(); } }, t('lyricsCard')) : null,
    h('button', { class: 'chip' + (mode === 'song' ? ' on' : ''), onclick: (e) => { mode = 'song'; markTabs(e); draw(); } }, t('songCard')));
  const markTabs = (e) => tabs.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === e.currentTarget));
  const dots = h('div', { class: 'swatches' }, swatches.map(([name, p], i) => h('button', {
    class: 'swatch' + (i === 0 ? ' on' : ''), 'aria-label': name, style: { background: `linear-gradient(160deg, ${p.top}, ${p.bottom})` },
    onclick: (e) => { sw = i; dots.querySelectorAll('.swatch').forEach((d) => d.classList.toggle('on', d === e.currentTarget)); draw(); } })));
  const link = tr.link || location.href;
  openSheet([
    tabs, h('div', { class: 'share-stage' }, preview, busy), dots,
    h('div', { class: 'share-actions' },
      h('button', { class: 'share-act', onclick: async () => {
        if (!blob) return;
        const r = await share.shareImage(blob, { title: tr.title, text: `${tr.title} — ${tr.artist}`, url: link });
        if (r === 'saved') toast(t('imageSaved'));
      } }, h('span', { class: 'share-ic ig' }, 'IG'), t('shareInstagram')),
      h('button', { class: 'share-act', onclick: () => { if (blob) { share.downloadBlob(blob, 'projectmusic-story.png'); toast(t('imageSaved')); } } }, h('span', { class: 'share-ic' }, icon('download', 22)), t('saveImage')),
      h('button', { class: 'share-act', onclick: async () => { try { await navigator.clipboard.writeText(link); toast(t('linkCopied')); } catch { toast(link); } } }, h('span', { class: 'share-ic' }, icon('link', 22)), t('copyLink'))),
  ], { label: t('share'), wide: true });
  draw();
}

/* =====================================================================
   Keeping the UI in sync with the player
   ===================================================================== */
const tintCache = new Map();
async function updateTint(tr) {
  if (!tr) return;
  const root = document.documentElement;
  if (tintCache.has(tr.id)) return root.style.setProperty('--tint', tintCache.get(tr.id));
  root.style.setProperty('--tint', '#3a2a30');
  if (!art(tr) || (tr.source === 'ytmusic' && !server)) return;
  try {
    const share = await import('./share.js');
    const img = await artworkForCanvas(tr);
    const rgb = img && share.dominantColor(img);
    if (!rgb) return;
    const p = share.paletteFrom(rgb);
    tintCache.set(tr.id, p.mid);
    if (player.current?.id === tr.id) root.style.setProperty('--tint', p.mid);
  } catch { /* keep the default tint */ }
}

let lastTrackId = null;
let playContext = '';
function syncPlayer() {
  const tr = player.current;
  document.body.classList.toggle('has-player', !!tr);
  if (!tr || !mini.art) return;
  const small = art(tr) || 'icons/icon-192.png';
  const large = art(tr, true) || 'icons/icon-512.png';
  for (const el of [mini.art, bar.art]) if (el.getAttribute('src') !== small) el.src = small;
  for (const el of [np.art, panel.art]) if (el.getAttribute('src') !== large) el.src = large;
  for (const [el, v] of [[mini.title, tr.title], [mini.artist, tr.artist], [bar.title, tr.title], [bar.artist, tr.artist], [np.title, tr.title], [np.artist, tr.artist], [panel.title, tr.title], [panel.artist, tr.artist]]) el.textContent = v;
  np.context.textContent = playContext || t('queue');
  document.title = `${tr.title} · ${tr.artist} — ProjectMusic`;

  const playing = player.playing;
  for (const b of [mini.play, bar.play, np.play]) { setIcon(b, playing ? 'pause' : 'play'); b.setAttribute('aria-label', playing ? t('pause') : t('play')); }
  const liked = favs.has(tr.id);
  for (const b of [mini.like, bar.like, np.like]) {
    b.hidden = !!tr.ephemeral;
    b.classList.toggle('on', liked);
    setIcon(b, liked ? 'heartFill' : 'heart');
    b.setAttribute('aria-label', liked ? t('removeLiked') : t('addLiked'));
  }
  for (const b of [bar.shuffle, np.shuffle]) { b.classList.toggle('on', player.shuffle); b.setAttribute('aria-pressed', String(player.shuffle)); }
  for (const b of [bar.repeat, np.repeat]) {
    b.classList.toggle('on', player.repeat !== 'off');
    b.setAttribute('aria-label', { off: t('repeatOff'), all: t('repeatAll'), one: t('repeatOne') }[player.repeat]);
    b.dataset.one = player.repeat === 'one' ? '1' : '';
  }
  view.querySelectorAll('.row').forEach((r) => r.classList.toggle('playing', r.dataset.id === tr.id));

  if (tr.id !== lastTrackId) {
    lastTrackId = tr.id;
    updateTint(tr);
    renderSideStatus();
    const lyricsVisible = (!np.root.hidden && (npMode === 'lyrics' || isDesktop())) || (isDesktop() && panelTab === 'lyrics');
    if (lyricsVisible) ensureLyrics(); else { lyr.forId = null; lyr.status = 'idle'; }
    if (npMode === 'queue') renderQueue(np.queue);
    if (panelTab === 'queue') renderQueue(panel.body);
  }
}

function syncTime() {
  const a = player.audio;
  const dur = Number.isFinite(a.duration) ? a.duration : player.current?.duration || 0;
  const ratio = dur ? Math.min(1, a.currentTime / dur) : 0;
  if (mini.bar) mini.bar.style.width = `calc((100% - 16px) * ${ratio.toFixed(4)})`;
  for (const [input, cur, total] of [[bar.seek, bar.cur, bar.dur], [np.seek, np.cur, np.dur]]) {
    if (!input) continue;
    total.textContent = fmt(dur);
    if (!input.dataset.seeking) {
      input.value = Math.round(ratio * 1000);
      cur.textContent = fmt(a.currentTime);
      input.style.setProperty('--p', (ratio * 100).toFixed(2) + '%');
    }
  }
  highlightLyrics(a.currentTime);
}

/* ---------- Autoplay radio, ordered by the taste model ---------- */
let radioBusy = false;
async function fillRadio() {
  const tr = player.current;
  if (!server || radioBusy || !tr || tr.source !== 'ytmusic' || !prefs.get('autoRadio')) return;
  if (player.remaining > 2) return;
  radioBusy = true;
  try {
    const more = taste.rank(await ytmusic.next(tr.videoId));
    if (more.length) player.appendMany(more.slice(0, 20));
  } catch { /* try again on the next song */ }
  finally { radioBusy = false; }
}

/* =====================================================================
   Glass (translucent floating bars): solid on weak devices or when asked
   ===================================================================== */
function applyGlass() {
  const weak = (navigator.deviceMemory && navigator.deviceMemory <= 2) || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4);
  const reduce = window.matchMedia('(prefers-reduced-transparency: reduce)').matches;
  document.body.classList.toggle('glass', !!prefs.get('glass') && !weak && !reduce);
}

/* =====================================================================
   Server connection
   ===================================================================== */
async function connectServer() {
  server = await ytmusic.detect(prefs.get('serverUrl'));
  player.refreshSource();
  render();
  syncPlayer();
  return server;
}

/* =====================================================================
   Local files: picker + drag & drop
   ===================================================================== */
function addFiles(files) {
  const tracks = local.fromFiles(files);
  if (!tracks.length) return;
  localTracks = [...localTracks, ...tracks];
  player.playList(localTracks, localTracks.length - tracks.length);
  if (currentRoute === 'library') render();
}

/* =====================================================================
   Welcome intro (first visit only): the logo draws itself, features appear
   ===================================================================== */
function showIntro() {
  if (prefs.get('introSeen')) return;
  const done = () => { prefs.set('introSeen', true); overlay.classList.add('out'); setTimeout(() => overlay.remove(), 400); };
  const mark = logo(120);
  mark.classList.add('intro-logo');
  const items = [['lyrics', t('welcome1')], ['share', t('welcome2')], ['mix', t('welcome3')]]
    .map(([ic, text], i) => h('li', { style: { animationDelay: 2.3 + i * 0.18 + 's' } }, icon(ic, 22), h('span', {}, text)));
  const overlay = h('div', { class: 'intro', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('welcomeTitle') },
    h('div', { class: 'intro-card' },
      mark,
      h('h1', {}, t('welcomeTitle')),
      h('p', { class: 'hint' }, t('welcomeText')),
      h('ul', {}, items),
      h('div', { class: 'intro-actions' },
        h('button', { class: 'btn primary', onclick: done }, t('startListening')),
        server ? null : h('a', { class: 'btn', href: 'get/', onclick: () => prefs.set('introSeen', true) }, t('setupServer')))));
  document.body.append(overlay);
  overlay.querySelector('.btn.primary').focus({ preventScroll: true });
  overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') done(); });
}

/* =====================================================================
   Start
   ===================================================================== */
function init() {
  document.documentElement.lang = lang();
  player.fadeSeconds = prefs.get('fade');
  player.volume = prefs.get('volume') ?? 1;
  player.resolve = (tr) => (tr.source === 'ytmusic' ? ytmusic.streamUrl(tr) : tr.streamUrl);

  // Remember where the music started ("Playing from …") and stop the mixer.
  const origPlayList = player.playList.bind(player);
  player.playList = (tracks, start) => {
    // "Playing from": the section the song was picked in, else the page title
    const from = document.activeElement?.closest?.('section')?.querySelector('h2');
    playContext = (from?.firstChild?.textContent || view.querySelector('h1')?.textContent || '').trim();
    import('./mix.js').then((m) => m.stopMix()).catch(() => {});
    origPlayList(tracks, start);
  };

  applyGlass();
  buildChrome();

  player.addEventListener('state', () => { syncPlayer(); fillRadio(); });
  player.addEventListener('time', syncTime);
  player.addEventListener('queue', () => {
    if (npMode === 'queue' && !np.root.hidden) renderQueue(np.queue);
    if (panelTab === 'queue') renderQueue(panel.body);
  });
  player.addEventListener('listened', (e) => taste.record(e.detail.track, e.detail.listened, e.detail.duration));
  player.addEventListener('sleep', () => { sleepIdx = 0; syncSleepChip(); toast(t('sleepDone')); });
  player.addEventListener('error', () => {
    const tr = player.current;
    toast(tr && tr.source === 'ytmusic' && !server ? t('serverNeeded') : t('unplayable'));
  });

  $('file-input').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { dragDepth++; document.body.classList.add('dragging'); } });
  window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); } });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => { e.preventDefault(); dragDepth = 0; document.body.classList.remove('dragging'); if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files); });
  $('drop').textContent = t('dropFiles');

  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea, select')) { if (e.key === 'Escape') e.target.blur(); return; }
    if (e.key === '/') { e.preventDefault(); go('#/search'); setTimeout(() => view.querySelector('input')?.focus(), 50); }
    else if (e.code === 'Space' && !e.target.matches('button, a')) { e.preventDefault(); player.toggle(); }
    else if (e.key === 'ArrowRight' && e.shiftKey) player.next();
    else if (e.key === 'ArrowLeft' && e.shiftKey) player.prev();
    else if (e.key === 'Escape') { if (!$('sheet-root').hidden) closeSheet(); else closeNowPlaying(); }
  });

  window.addEventListener('hashchange', () => { closeNowPlaying(); closeSheet(); render(); window.scrollTo(0, 0); });
  window.addEventListener('offline', () => toast(t('offline')));
  window.matchMedia('(min-width: 1024px)').addEventListener('change', () => { if (panelTab === 'lyrics') ensureLyrics(); });

  render();
  syncPlayer();
  connectServer().then(showIntro);

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
}

init();
