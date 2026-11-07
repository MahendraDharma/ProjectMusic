// Share cards for Instagram Stories (1080×1920 PNG), drawn on a <canvas>.
//   Lyrics card = design A "Full color": artwork colour fills the story, big lyrics,
//                 a song chip with the logo at the bottom.
//   Song card   = design E "Player sticker": a glass mini player over the blurred artwork.
// The image is handed to the phone's share sheet (Instagram, WhatsApp, …); on computers
// it is downloaded instead.
const W = 1080;
const H = 1920;

/* ---------- Colours from artwork ---------- */
export function loadImage(url) {
  return new Promise((resolve) => {
    if (!url) return resolve(null);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
const hex = ([r, g, b]) => '#' + [r, g, b].map((v) => clamp(v).toString(16).padStart(2, '0')).join('');
const mixRgb = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

/** Most characterful colour of an image (average of its more saturated pixels). */
export function dominantColor(img) {
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 24;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, 24, 24);
    const d = ctx.getImageData(0, 0, 24, 24).data;
    let sum = [0, 0, 0], n = 0, all = [0, 0, 0];
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      all[0] += r; all[1] += g; all[2] += b;
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      if (max - min > 40 && max > 60 && max < 245) { sum[0] += r; sum[1] += g; sum[2] += b; n++; }
    }
    const px = d.length / 4;
    return n > px * 0.08 ? sum.map((v) => v / n) : all.map((v) => v / px);
  } catch {
    return null; // tainted canvas (no CORS) — caller falls back
  }
}

export function paletteFrom(rgb) {
  const base = rgb || [157, 78, 92];
  // keep it rich but readable behind white text
  const lum = (0.299 * base[0] + 0.587 * base[1] + 0.114 * base[2]) / 255;
  const top = lum > 0.62 ? mixRgb(base, [0, 0, 0], 0.35) : mixRgb(base, [255, 255, 255], 0.08);
  return { top: hex(top), bottom: hex(mixRgb(base, [8, 8, 10], 0.72)), mid: hex(base), rgb: base };
}

/* ---------- Drawing helpers ---------- */
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrap(ctx, text, maxWidth) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = w; } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

function drawArt(ctx, img, x, y, size, r, fallback) {
  ctx.save();
  roundRect(ctx, x, y, size, size, r);
  ctx.clip();
  if (img) {
    const s = Math.min(img.naturalWidth, img.naturalHeight);
    ctx.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, x, y, size, size);
  } else {
    const g = ctx.createLinearGradient(x, y, x + size, y + size);
    g.addColorStop(0, fallback.top);
    g.addColorStop(1, fallback.bottom);
    ctx.fillStyle = g;
    ctx.fillRect(x, y, size, size);
  }
  ctx.restore();
}

function drawLogo(ctx, x, y, size, accent) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 1024, size / 1024);
  roundRect(ctx, 0, 0, 1024, 1024, 228);
  ctx.fillStyle = '#111315';
  ctx.fill();
  ctx.translate(512, 512); ctx.scale(0.86, 0.86); ctx.translate(-532, -522);
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 80; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(372, 300); ctx.lineTo(372, 744); ctx.stroke();
  ctx.beginPath(); ctx.arc(532, 460, 160, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = accent; ctx.beginPath(); ctx.arc(690, 716, 42, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = accent; ctx.lineWidth = 22;
  ctx.beginPath(); ctx.moveTo(727, 718); ctx.lineTo(727, 586); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(727, 586); ctx.bezierCurveTo(756, 600, 786, 618, 776, 668); ctx.stroke();
  ctx.restore();
}

function ellipsize(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(s + '…').width > maxWidth) s = s.slice(0, -1);
  return s + '…';
}

async function fonts() {
  try {
    await Promise.all([document.fonts.load('500 64px "DM Sans"'), document.fonts.load('400 40px "DM Sans"')]);
  } catch { /* system font fallback */ }
}
const FONT = '"DM Sans", system-ui, sans-serif';

/* ---------- Design A: lyrics card ---------- */
export async function lyricsCard({ track, lines, img, palette, accent = '#FF375F' }) {
  await fonts();
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, W * 0.3, H);
  g.addColorStop(0, palette.top);
  g.addColorStop(1, palette.bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // quote mark
  ctx.fillStyle = 'rgba(255,255,255,.35)';
  ctx.font = `500 220px ${FONT}`;
  ctx.fillText('“', 92, 470);

  // lyrics: as large as fits
  const text = lines.join('\n');
  let size = 96;
  let wrapped;
  for (; size >= 52; size -= 4) {
    ctx.font = `500 ${size}px ${FONT}`;
    wrapped = lines.flatMap((l) => wrap(ctx, l, W - 184));
    if (wrapped.length * size * 1.16 <= 900) break;
  }
  ctx.fillStyle = '#FFFFFF';
  ctx.textBaseline = 'top';
  let y = 560;
  for (const l of wrapped) { ctx.fillText(l, 92, y); y += size * 1.16; }
  if (!text) wrapped = [];

  // song chip
  const chipY = H - 400;
  ctx.fillStyle = 'rgba(0,0,0,.24)';
  roundRect(ctx, 64, chipY, W - 128, 200, 40);
  ctx.fill();
  drawArt(ctx, img, 96, chipY + 32, 136, 20, palette);
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `500 46px ${FONT}`;
  ctx.fillText(ellipsize(ctx, track.title, W - 128 - 420), 264, chipY + 52);
  ctx.fillStyle = 'rgba(255,255,255,.78)';
  ctx.font = `400 38px ${FONT}`;
  ctx.fillText(ellipsize(ctx, track.artist, W - 128 - 420), 264, chipY + 112);
  drawLogo(ctx, W - 96 - 88, chipY + 56, 88, accent);
  return c;
}

/* ---------- Design E: song card (player sticker) ---------- */
export async function songCard({ track, img, palette, accent = '#FF375F', position = 0.42 }) {
  await fonts();
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');

  // blurred artwork background: draw tiny, then scale up (works in every browser)
  ctx.fillStyle = palette.bottom;
  ctx.fillRect(0, 0, W, H);
  if (img) {
    const tiny = document.createElement('canvas');
    tiny.width = 12; tiny.height = 20;
    const tctx = tiny.getContext('2d');
    const s = Math.min(img.naturalWidth, img.naturalHeight);
    tctx.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, -4, 0, 20, 20);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.globalAlpha = 0.9;
    ctx.drawImage(tiny, -60, -60, W + 120, H + 120);
    ctx.globalAlpha = 1;
  } else {
    const g = ctx.createRadialGradient(W * 0.35, H * 0.35, 40, W * 0.5, H * 0.5, H * 0.7);
    g.addColorStop(0, palette.top);
    g.addColorStop(1, palette.bottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.fillStyle = 'rgba(0,0,0,.25)';
  ctx.fillRect(0, 0, W, H);

  // the sticker
  const sw = 860, sh = 560, sx = (W - sw) / 2, sy = 640;
  ctx.save();
  ctx.translate(W / 2, sy + sh / 2);
  ctx.rotate((-2 * Math.PI) / 180);
  ctx.translate(-W / 2, -(sy + sh / 2));
  ctx.shadowColor = 'rgba(0,0,0,.45)';
  ctx.shadowBlur = 80;
  ctx.shadowOffsetY = 40;
  ctx.fillStyle = 'rgba(28,29,33,.72)';
  roundRect(ctx, sx, sy, sw, sh, 64);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = 'rgba(255,255,255,.18)';
  ctx.lineWidth = 2;
  ctx.stroke();

  drawArt(ctx, img, sx + 44, sy + 44, 236, 32, palette);
  drawLogo(ctx, sx + 316, sy + 60, 40, accent);
  ctx.fillStyle = 'rgba(255,255,255,.72)';
  ctx.font = `500 32px ${FONT}`;
  ctx.textBaseline = 'top';
  ctx.fillText('Now playing', sx + 370, sy + 64);
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `500 56px ${FONT}`;
  ctx.fillText(ellipsize(ctx, track.title, sw - 360), sx + 316, sy + 128);
  ctx.fillStyle = 'rgba(255,255,255,.78)';
  ctx.font = `400 40px ${FONT}`;
  ctx.fillText(ellipsize(ctx, track.artist, sw - 360), sx + 316, sy + 200);

  // progress
  const py = sy + 340;
  ctx.fillStyle = 'rgba(255,255,255,.25)';
  roundRect(ctx, sx + 44, py, sw - 88, 10, 5); ctx.fill();
  ctx.fillStyle = '#FFFFFF';
  roundRect(ctx, sx + 44, py, (sw - 88) * position, 10, 5); ctx.fill();

  // controls: prev · pause · next
  const cy = sy + 450;
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath(); ctx.arc(W / 2, cy, 58, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#111315';
  ctx.fillRect(W / 2 - 22, cy - 26, 14, 52);
  ctx.fillRect(W / 2 + 8, cy - 26, 14, 52);
  ctx.fillStyle = '#FFFFFF';
  const tri = (x, dir) => { ctx.beginPath(); ctx.moveTo(x, cy - 26); ctx.lineTo(x, cy + 26); ctx.lineTo(x + dir * 36, cy); ctx.closePath(); ctx.fill(); };
  tri(W / 2 - 150, -1); ctx.fillRect(W / 2 - 196, cy - 26, 8, 52);
  tri(W / 2 + 150, 1); ctx.fillRect(W / 2 + 188, cy - 26, 8, 52);
  ctx.restore();
  return c;
}

/* ---------- Hand the image to the phone ---------- */
export function canvasToBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
}

/** Returns 'shared' | 'saved' | 'cancelled'. */
export async function shareImage(blob, { title, text, url }) {
  const file = new File([blob], 'projectmusic-story.png', { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title, text });
      return 'shared';
    } catch (e) {
      if (e && e.name === 'AbortError') return 'cancelled';
    }
  }
  downloadBlob(blob, 'projectmusic-story.png');
  return 'saved';
}

export function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}
