// Box and tag drawing ported from object_recog, used for the full-screen view and the
// AR overlay.
import { CONFIG } from './config.js';

// Dark text on light colors, white on dark ones.
function textColorOn(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = n >> 16;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 140 ? '#000' : '#fff';
}

export const tagText = (t) => (CONFIG.showScore ? `${t.name} ${Math.round(t.score * 100)}%` : t.name);

// Size of a tag for font size fs, in the same units as fs.
export function measureTag(ctx, text, fs) {
  ctx.font = `${fs}px ui-monospace, Menlo, Consolas, monospace`;
  const padX = fs * 0.55;
  return { padX, width: ctx.measureText(text).width + padX * 2, height: fs * 1.5 };
}

export function drawTag(ctx, text, x, y, fs, color) {
  const { padX, width, height } = measureTag(ctx, text, fs);
  ctx.fillStyle = color;
  ctx.fillRect(x, y, width, height);
  ctx.fillStyle = textColorOn(color);
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + padX, y + height / 2 + 1);
}

// Draws the tracks onto a canvas that already holds the camera picture (w × h pixels).
export function drawTracks(ctx, tracks, w, h) {
  const s = w / 640;
  const lw = CONFIG.lineWidth * s;
  ctx.lineJoin = 'miter';
  for (const t of tracks) {
    const x = t.x * w;
    const y = t.y * h;
    ctx.lineWidth = lw;
    ctx.strokeStyle = t.color;
    ctx.strokeRect(x, y, t.w * w, t.h * h);

    const fs = Math.max(11, 17 * s);
    const text = tagText(t);
    const tag = measureTag(ctx, text, fs);
    const lx = Math.min(Math.max(x - lw / 2, 0), w - tag.width);
    let ly = y - tag.height + lw / 2; // tag sits on top of the box
    if (ly < 0) ly = y + lw / 2; // no room above: put it inside
    drawTag(ctx, text, lx, ly, fs, t.color);
  }
}
