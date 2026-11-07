// Mix: blend two songs like a tiny DJ setup. Each deck has its own volume, bass and
// treble; a crossfader slides between them. Uses the Web Audio API, which is only
// created when the person presses play here, so the rest of the app stays light.
import { h, icon, fmt, toast } from './ui.js';
import { t } from './i18n.js';

let ctx = null;
const decks = { A: null, B: null };

function audioContext() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function makeDeck(name) {
  const audio = new Audio();
  audio.crossOrigin = 'anonymous'; // needed so Web Audio may process the stream
  audio.preload = 'auto';
  return { name, audio, track: null, nodes: null, volume: 0.9, bass: 0, treble: 0 };
}

function wire(deck) {
  if (deck.nodes) return deck.nodes;
  const ac = audioContext();
  const src = ac.createMediaElementSource(deck.audio);
  const low = ac.createBiquadFilter();
  low.type = 'lowshelf';
  low.frequency.value = 220;
  const high = ac.createBiquadFilter();
  high.type = 'highshelf';
  high.frequency.value = 3200;
  const vol = ac.createGain();
  const fader = ac.createGain();
  src.connect(low).connect(high).connect(vol).connect(fader).connect(ac.destination);
  deck.nodes = { low, high, vol, fader };
  return deck.nodes;
}

function applyDeck(deck, x) {
  if (!deck.nodes) return;
  deck.nodes.vol.gain.value = deck.volume;
  deck.nodes.low.gain.value = deck.bass;
  deck.nodes.high.gain.value = deck.treble;
  // equal-power crossfader: A = cos, B = sin
  const g = deck.name === 'A' ? Math.cos((x * Math.PI) / 2) : Math.sin((x * Math.PI) / 2);
  deck.nodes.fader.gain.value = g;
}

/**
 * Render the Mix page into `view`.
 * deps: { resolve(track), pickTrack(callback), pauseMain(), preset: {A?, B?} }
 */
export function renderMix(view, deps) {
  decks.A ??= makeDeck('A');
  decks.B ??= makeDeck('B');
  if (deps.preset?.A) setTrack(decks.A, deps.preset.A);
  if (deps.preset?.B) setTrack(decks.B, deps.preset.B);
  let x = renderMix.x ?? 0.5;

  function setTrack(deck, track) {
    deck.track = track;
    deck.audio.src = deps.resolve(track);
    deck.audio.load();
  }

  const fader = h('input', { type: 'range', min: 0, max: 100, value: Math.round(x * 100), class: 'mix-fader', 'aria-label': t('crossfader') });
  fader.addEventListener('input', () => {
    x = fader.value / 100;
    renderMix.x = x;
    applyDeck(decks.A, x);
    applyDeck(decks.B, x);
  });

  const deckEls = ['A', 'B'].map((name) => deckCard(decks[name]));

  function deckCard(deck) {
    const art = h('span', { class: 'mix-art' });
    const title = h('b', {});
    const artist = h('small', {});
    const pos = h('input', { type: 'range', min: 0, max: 1000, value: 0, class: 'mix-pos', 'aria-label': t('deck' + deck.name) + ' position' });
    const time = h('span', { class: 'mix-time' }, '0:00');
    const playBtn = h('button', { class: 'round-btn', 'aria-label': t('play') }, icon('play', 22));
    const choose = h('button', { class: 'pill', onclick: () => deps.pickTrack((tr) => { setTrack(deck, tr); paint(); }) }, '');
    const slider = (label, min, max, step, value, onInput) => {
      const input = h('input', { type: 'range', min, max, step, value });
      input.addEventListener('input', () => onInput(+input.value));
      return h('label', { class: 'mix-knob' }, h('span', {}, label), input);
    };
    const paint = () => {
      const tr = deck.track;
      title.textContent = tr ? tr.title : t('chooseSong');
      artist.textContent = tr ? tr.artist : '';
      art.style.backgroundImage = tr && tr.artwork ? `url("${tr.artwork}")` : '';
      playBtn.replaceChildren(icon(deck.audio.paused ? 'play' : 'pause', 22));
      choose.textContent = tr ? t('change') : t('chooseSong');
    };
    deck.audio.addEventListener('timeupdate', () => {
      const d = deck.audio.duration;
      if (Number.isFinite(d) && d > 0 && document.activeElement !== pos) pos.value = Math.round((deck.audio.currentTime / d) * 1000);
      time.textContent = fmt(deck.audio.currentTime);
    });
    deck.audio.addEventListener('play', paint);
    deck.audio.addEventListener('pause', paint);
    pos.addEventListener('change', () => {
      const d = deck.audio.duration;
      if (Number.isFinite(d)) deck.audio.currentTime = (pos.value / 1000) * d;
    });
    playBtn.addEventListener('click', () => {
      if (!deck.track) return toast(t('chooseSong'));
      wire(deck);
      applyDeck(deck, x);
      deps.pauseMain();
      if (deck.audio.paused) deck.audio.play().catch(() => toast(t('unplayable'))); else deck.audio.pause();
    });
    paint();
    return h('section', { class: 'mix-deck' },
      h('div', { class: 'mix-head' }, h('span', { class: 'mix-label' }, t('deck' + deck.name)), choose),
      h('div', { class: 'mix-track' }, art, h('span', { class: 'mix-text' }, title, artist)),
      h('div', { class: 'mix-row' }, playBtn, pos, time),
      slider(t('volume'), 0, 1, 0.01, deck.volume, (v) => { deck.volume = v; applyDeck(deck, x); }),
      slider(t('bass'), -12, 12, 1, deck.bass, (v) => { deck.bass = v; applyDeck(deck, x); }),
      slider(t('treble'), -12, 12, 1, deck.treble, (v) => { deck.treble = v; applyDeck(deck, x); }),
    );
  }

  const both = h('button', { class: 'btn primary', onclick: () => {
    if (!decks.A.track || !decks.B.track) return toast(t('mixNeedsSong'));
    const anyPlaying = !decks.A.audio.paused || !decks.B.audio.paused;
    if (anyPlaying) { decks.A.audio.pause(); decks.B.audio.pause(); both.lastChild.textContent = t('playBoth'); return; }
    deps.pauseMain();
    for (const d of [decks.A, decks.B]) { wire(d); applyDeck(d, x); d.audio.play().catch(() => toast(t('unplayable'))); }
    both.lastChild.textContent = t('stopBoth');
  } }, icon('play', 18), h('span', {}, t('playBoth')));
  const sync = h('button', { class: 'btn', onclick: () => {
    for (const d of [decks.A, decks.B]) if (d.track) d.audio.currentTime = 0;
  } }, t('syncStart'));

  view.replaceChildren(
    h('header', { class: 'page-head' }, h('h1', {}, t('mixTitle'))),
    h('p', { class: 'hint' }, t('mixHint')),
    h('div', { class: 'mix-decks' }, deckEls[0], deckEls[1]),
    h('div', { class: 'mix-cross' }, h('span', {}, 'A'), fader, h('span', {}, 'B')),
    h('p', { class: 'hint center' }, t('crossfader')),
    h('div', { class: 'row-actions center' }, both, sync),
  );
}

/** Stop both decks (e.g. when the main player starts again). */
export function stopMix() {
  for (const d of [decks.A, decks.B]) d?.audio.pause();
}
