// "Get ProjectMusic" page: language switch (shared with the app's setting),
// OS tabs, live check for the personal server, and download details.
(function () {
  const KEY = 'pm:settings';
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
  const write = (patch) => { try { localStorage.setItem(KEY, JSON.stringify({ ...read(), ...patch })); } catch { /* private mode */ } };

  /* ---------- language ---------- */
  let lang = read().lang === 'id' ? 'id' : (navigator.language || '').toLowerCase().startsWith('id') && !read().lang ? 'id' : 'en';
  function setLang(l) {
    lang = l;
    document.documentElement.lang = l;
    document.querySelectorAll('[data-lang-block]').forEach((m) => { m.hidden = m.dataset.langBlock !== l; });
    document.querySelectorAll('[data-lang]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === l)));
    document.title = l === 'id' ? 'Unduh ProjectMusic' : 'Get ProjectMusic';
    paintStatus();
  }
  document.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', () => { write({ lang: b.dataset.lang }); setLang(b.dataset.lang); }));

  /* ---------- OS tabs (pre-select the visitor's system) ---------- */
  const ua = navigator.userAgent;
  const guess = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? 'iphone'
    : /Android/.test(ua) ? 'android' : /Windows/.test(ua) ? 'windows' : /Mac/.test(ua) ? 'mac' : /Linux|X11/.test(ua) ? 'linux' : 'windows';
  function setOs(os) {
    document.querySelectorAll('[data-os]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.os === os)));
    document.querySelectorAll('[data-os-panel]').forEach((p) => { p.hidden = p.dataset.osPanel !== os; });
  }
  document.querySelectorAll('[data-os]').forEach((b) => b.addEventListener('click', () => setOs(b.dataset.os)));
  setOs(guess);

  /* ---------- personal server check ---------- */
  let server = null; // { base, version } when found
  let checked = false;
  const normalize = (u) => { u = (u || '').trim(); if (!u) return ''; if (!/^https?:\/\//i.test(u)) u = 'http://' + u; return u.replace(/\/*$/, '/'); };
  async function probe(base) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2500);
    try {
      const r = await fetch(base + 'api/health', { signal: ctrl.signal });
      const info = r.ok ? await r.json() : null;
      return info && info.mode === 'server' ? { base, version: info.version } : null;
    } catch { return null; } finally { clearTimeout(timer); }
  }
  async function check() {
    const saved = normalize(read().serverUrl);
    const candidates = [...new Set([saved, 'http://localhost:8080/'].filter(Boolean))];
    let found = null;
    for (const c of candidates) { found = await probe(c); if (found) break; }
    server = found;
    checked = true;
    paintStatus();
  }
  function paintStatus() {
    const text = {
      en: { wait: 'Checking for your server…', on: (s) => `Your server is running (${s.base.replace(/\/$/, '')}). You're ready to listen.`, off: 'No server running on this device yet. Follow the steps below, then this turns green.' },
      id: { wait: 'Mengecek server…', on: (s) => `Server kamu menyala (${s.base.replace(/\/$/, '')}). Siap mendengarkan.`, off: 'Belum ada server yang menyala di perangkat ini. Ikuti langkah di bawah, nanti status ini jadi hijau.' },
    }[lang];
    document.querySelectorAll('[data-status]').forEach((el) => {
      el.classList.toggle('on', !!server);
      el.querySelector('[data-status-text]').textContent = !checked ? text.wait : server ? text.on(server) : text.off;
      const open = el.querySelector('[data-open]');
      open.hidden = !server;
      // The site connects to the server by itself; Safari may block that, so offer the direct address there.
      const safari = /Safari/.test(ua) && !/Chrome|Chromium|Edg|Firefox|FxiOS|CriOS/.test(ua);
      open.href = server && safari ? server.base : '../';
    });
  }
  check();
  setInterval(() => { if (!document.hidden) check(); }, 5000);

  /* ---------- download details ---------- */
  fetch('../download/latest.json', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : Promise.reject()))
    .then((d) => {
      const mb = (d.bytes / 1048576).toFixed(1);
      const label = { en: `Windows · Mac · Linux · Android (Termux) — ${mb} MB · version ${d.version}`, id: `Windows · Mac · Linux · Android (Termux) — ${mb} MB · versi ${d.version}` };
      document.querySelectorAll('[data-lang-block]').forEach((m) => { const el = m.querySelector('[data-meta]'); if (el) el.textContent = label[m.dataset.langBlock]; });
    })
    .catch(() => {
      // No packaged zip (e.g. running locally): fall back to GitHub's own archive.
      document.querySelectorAll('[data-download]').forEach((a) => { a.href = 'https://github.com/MahendraDharma/ProjectMusic/archive/refs/heads/main.zip'; a.removeAttribute('download'); });
    });

  /* ---------- Intro animations: drawing logo + feature showcase ---------- */
  const NS = 'http://www.w3.org/2000/svg';
  function animatedLogo() {
    const wrap = document.createElement('div');
    wrap.className = 'hero-visual';
    wrap.setAttribute('aria-hidden', 'true');
    // Static, trusted markup (no outside data).
    wrap.innerHTML = `
      <svg class="logo-anim" viewBox="0 0 1024 1024" width="260" height="260">
        <rect class="la-bg" width="1024" height="1024" rx="228" fill="#111315"/>
        <g transform="translate(512 512) scale(.86) translate(-532 -522)">
          <path class="la-stem" d="M372 300 L372 744" stroke="#fff" stroke-width="80" stroke-linecap="round" fill="none" pathLength="1"/>
          <circle class="la-bowl" cx="532" cy="460" r="160" stroke="#fff" stroke-width="80" fill="none" pathLength="1" transform="rotate(180 532 460)"/>
          <circle class="la-dot" cx="690" cy="716" r="42" fill="#FF375F"/>
          <path class="la-note" d="M727 718 L727 586" stroke="#FF375F" stroke-width="22" stroke-linecap="round" fill="none" pathLength="1"/>
          <path class="la-flag" d="M727 586 C756 600 786 618 776 668" stroke="#FF375F" stroke-width="22" stroke-linecap="round" fill="none" pathLength="1"/>
        </g>
      </svg>
      <div class="eq">${'<span></span>'.repeat(9)}</div>`;
    return wrap;
  }

  const FEATURES = {
    en: [
      ['catalog', 'The whole YouTube Music catalogue', 'Indonesian charts, every popular artist, search that finds the song you meant.'],
      ['lyrics', 'Synced lyrics', 'Lines light up with the music. Tap one to jump there.'],
      ['fade', 'Smooth transitions', 'The end of a song fades out while the next one fades in.'],
      ['share', 'Share to Instagram', 'Turn a few lyric lines or the whole song into a Story card.'],
      ['mix', 'Mix two songs', 'Two decks, a crossfader, bass and treble. A tiny DJ set in your browser.'],
      ['taste', 'Made for you', 'Learns what you finish and what you skip — on your device, never uploaded.'],
    ],
    id: [
      ['catalog', 'Seluruh katalog YouTube Music', 'Tangga lagu Indonesia, semua artis populer, pencarian yang menemukan lagu yang kamu maksud.'],
      ['lyrics', 'Lirik tersinkron', 'Baris lirik menyala mengikuti musik. Ketuk untuk lompat ke bagian itu.'],
      ['fade', 'Transisi halus', 'Akhir lagu memudar sementara lagu berikutnya masuk perlahan.'],
      ['share', 'Bagikan ke Instagram', 'Jadikan beberapa baris lirik atau satu lagu kartu Story.'],
      ['mix', 'Mix dua lagu', 'Dua deck, crossfader, bass, dan treble. DJ kecil di browsermu.'],
      ['taste', 'Untukmu', 'Belajar lagu yang kamu dengar sampai habis dan yang kamu lewati — di perangkatmu, tidak pernah diunggah.'],
    ],
  };
  const DEMO = {
    catalog: '<div class="d-cards">' + '<span></span>'.repeat(8) + '</div>',
    lyrics: '<div class="d-lyrics">' + '<span></span>'.repeat(5) + '</div>',
    fade: '<div class="d-fade"><span class="a"></span><span class="b"></span></div>',
    share: '<div class="d-share"><span class="phone"><span class="story"><i></i><i></i><i></i></span></span></div>',
    mix: '<div class="d-mix"><span class="deck"></span><span class="rail"><i></i></span><span class="deck"></span></div>',
    taste: '<div class="d-taste">' + '<span></span>'.repeat(5) + '</div>',
  };
  function showcase(l) {
    const sec = document.createElement('section');
    sec.className = 'features';
    const h = document.createElement('h2');
    h.textContent = l === 'id' ? 'Yang ada di dalamnya' : 'What’s inside';
    const grid = document.createElement('div');
    grid.className = 'feature-grid';
    for (const [key, title, text] of FEATURES[l]) {
      const card = document.createElement('article');
      card.className = 'feature reveal';
      const demo = document.createElement('div');
      demo.className = 'demo';
      demo.setAttribute('aria-hidden', 'true');
      demo.innerHTML = DEMO[key]; // static markup from this file
      const t = document.createElement('h3');
      t.textContent = title;
      const p = document.createElement('p');
      p.textContent = text;
      card.append(demo, t, p);
      grid.append(card);
    }
    sec.append(h, grid);
    return sec;
  }
  document.querySelectorAll('[data-lang-block]').forEach((m) => {
    const hero = m.querySelector('.hero');
    hero.classList.add('has-visual');
    hero.prepend(animatedLogo());
    hero.after(showcase(m.dataset.langBlock));
    m.querySelectorAll('section:not(.hero):not(.features)').forEach((s) => s.classList.add('reveal'));
  });

  // Reveal sections as they scroll into view
  const reveals = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const io = new IntersectionObserver((entries) => entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }), { threshold: 0.15 });
    reveals.forEach((el, i) => { el.style.setProperty('--d', (i % 3) * 90 + 'ms'); io.observe(el); });
  } else {
    reveals.forEach((el) => el.classList.add('in'));
  }

  setLang(lang);
})();
