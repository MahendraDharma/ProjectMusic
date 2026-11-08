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

  setLang(lang);
})();
