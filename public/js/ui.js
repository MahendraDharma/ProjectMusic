// Small UI toolkit: DOM builder (never innerHTML with outside data), stroke icons,
// time formatting, toast and bottom sheet.

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

const PATHS = {
  home: '<path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>',
  library: '<path d="M5 4v16M10 4v16"/><path d="m14.5 4.5 4.8 15"/>',
  mix: '<circle cx="7" cy="12" r="4"/><circle cx="17" cy="12" r="4"/><path d="M7 12h10"/>',
  settings: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  more: '<circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none"/>',
  play: '<path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor" stroke="none"/>',
  next: '<path d="M6 6v12l8.5-6z" fill="currentColor" stroke="none"/><path d="M18 6v12"/>',
  prev: '<path d="M18 6v12l-8.5-6z" fill="currentColor" stroke="none"/><path d="M6 6v12"/>',
  shuffle: '<path d="M4 7h3c4 0 6 10 10 10h3M4 17h3c1.6 0 2.8-1.6 3.9-3.6M13.1 9.6C14.2 8.1 15.4 7 17 7h3"/><path d="m18 4.5 2.5 2.5-2.5 2.5M18 14.5l2.5 2.5-2.5 2.5"/>',
  repeat: '<path d="M5 11V9a3 3 0 0 1 3-3h11m-3-3 3 3-3 3M19 13v2a3 3 0 0 1-3 3H5m3 3-3-3 3-3"/>',
  heart: '<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z"/>',
  heartFill: '<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z" fill="currentColor"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  back: '<path d="m15 6-6 6 6 6"/>',
  forward: '<path d="m9 6 6 6-6 6"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  queue: '<path d="M4 6h12M4 11h12M4 16h7"/><path d="M16 14v6l4.5-3z" fill="currentColor" stroke="none"/>',
  lyrics: '<path d="M5 5h14v10H9l-4 4z"/><path d="M9 9h6M9 12h3"/>',
  moon: '<path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l2.5 2.5"/>',
  folder: '<path d="M4 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/>',
  share: '<path d="M12 15V4m-4.5 4.5L12 4l4.5 4.5M5 13v6a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-6"/>',
  playNext: '<path d="M4 7h10M4 12h10M4 17h6"/><path d="M17 10v8M13 14h8"/>',
  addQueue: '<path d="M4 7h12M4 12h12M4 17h8"/><path d="M18 14v6M15 17h6"/>',
  radio: '<circle cx="12" cy="12" r="2"/><path d="M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7M5.6 5.6a9 9 0 0 0 0 12.8M18.4 5.6a9 9 0 0 1 0 12.8"/>',
  user: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>',
  download: '<path d="M12 4v11m-4.5-4.5L12 15l4.5-4.5M5 20h14"/>',
  volume: '<path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z" fill="currentColor"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  note: '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  import: '<path d="M12 4v10m-4-4 4 4 4-4"/><path d="M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"/>',
  playlist: '<path d="M4 6h11M4 11h11M4 16h7"/><circle cx="16.5" cy="17" r="2.5"/><path d="M19 17V9l2.5-1"/>',
  edit: '<path d="M5 19h4L19 9l-4-4L5 15z"/>',
  trash: '<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/>',
  expand: '<path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/>',
};

const NS = 'http://www.w3.org/2000/svg';
export function icon(name, size = 24) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'ic');
  svg.innerHTML = PATHS[name] || ''; // trusted, static markup from this file only
  return svg;
}

export function setIcon(el, name) {
  const svg = el.querySelector('svg.ic');
  if (svg) svg.innerHTML = PATHS[name] || '';
}

/** The "p." logo with a music note, in any accent colour. */
export function logo(size = 28) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 1024 1024');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = '<rect width="1024" height="1024" rx="228" fill="#111315"/><g transform="translate(512 512) scale(.86) translate(-532 -522)"><path d="M372 300 L372 744" stroke="#fff" stroke-width="80" stroke-linecap="round"/><circle cx="532" cy="460" r="160" fill="none" stroke="#fff" stroke-width="80"/><circle cx="690" cy="716" r="42" fill="var(--accent)"/><path d="M727 718 L727 586" stroke="var(--accent)" stroke-width="22" stroke-linecap="round"/><path d="M727 586 C756 600 786 618 776 668" fill="none" stroke="var(--accent)" stroke-width="22" stroke-linecap="round"/></g>';
  return svg;
}

export function fmt(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  sec = Math.floor(sec);
  const m = Math.floor(sec / 60);
  const s = String(sec % 60).padStart(2, '0');
  return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

let toastTimer;
export function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

/* ---------- Bottom sheet (on desktop it shows as a centered panel) ---------- */
let sheetClose = null;
export function openSheet(content, { label = '', wide = false } = {}) {
  closeSheet();
  const root = document.getElementById('sheet-root');
  const backdrop = h('button', { class: 'sheet-backdrop', 'aria-label': 'Close', onclick: () => closeSheet() });
  const panel = h('div', { class: 'sheet' + (wide ? ' wide' : ''), role: 'dialog', 'aria-label': label, 'aria-modal': 'true' },
    h('span', { class: 'grab', 'aria-hidden': 'true' }), content);
  root.replaceChildren(backdrop, panel);
  root.hidden = false;
  const onKey = (e) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); closeSheet(); } };
  document.addEventListener('keydown', onKey, true);
  sheetClose = () => { document.removeEventListener('keydown', onKey, true); };
  requestAnimationFrame(() => root.classList.add('open'));
  const first = panel.querySelector('button, [href], input');
  first?.focus({ preventScroll: true });
  return panel;
}

export function closeSheet() {
  const root = document.getElementById('sheet-root');
  if (!root || root.hidden) return;
  sheetClose?.();
  sheetClose = null;
  root.classList.remove('open');
  root.hidden = true;
  root.replaceChildren();
}

/* ---------- Skeleton placeholders while loading ---------- */
export function skeletonRows(n = 5) {
  return h('div', { class: 'skel-list', 'aria-busy': 'true' },
    Array.from({ length: n }, () => h('div', { class: 'skel-row' }, h('span', { class: 'skel art' }), h('span', { class: 'skel-lines' }, h('span', { class: 'skel l1' }), h('span', { class: 'skel l2' })))));
}
export function skeletonCards(n = 4) {
  return h('div', { class: 'cards', 'aria-busy': 'true' },
    Array.from({ length: n }, () => h('div', { class: 'card' }, h('span', { class: 'skel cover' }), h('span', { class: 'skel l1' }), h('span', { class: 'skel l2' }))));
}

/* ---------- Pixel cloud: the loading animation ----------
   A cloud made of square pixels that shimmer left to right, with pink pixel "rain"
   falling from it. Pure SVG + CSS (see .pcloud in style.css). */
const CLOUD = [
  '....###.....',
  '...#####.##.',
  '.##########.',
  '############',
  '############',
  '.##########.',
];
export function pixelCloudMarkup() {
  let rects = '';
  CLOUD.forEach((row, y) => [...row].forEach((c, x) => {
    if (c === '#') rects += `<rect x="${x + 0.08}" y="${y + 0.08}" width=".84" height=".84" style="--i:${x + y}"/>`;
  }));
  const drops = [[3, 0], [6, 1], [9, 2]].map(([x, i]) => `<rect class="drop" x="${x + 0.15}" y="6.6" width=".7" height=".7" style="--i:${i}"/>`).join('');
  return `<svg class="pcloud" viewBox="0 0 12 10" aria-hidden="true"><g class="pc-body">${rects}</g>${drops}</svg>`;
}
export function pixelCloud(cls = '') {
  const wrap = document.createElement('span');
  wrap.className = 'pcloud-wrap' + (cls ? ' ' + cls : '');
  wrap.innerHTML = pixelCloudMarkup(); // static markup built above, no outside data
  return wrap;
}
