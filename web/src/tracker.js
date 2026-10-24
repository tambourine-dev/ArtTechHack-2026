import { CONFIG } from './config.js';

// Matches new detections to existing boxes so they glide instead of jitter (ported from
// object_recog). Boxes are in normalised image coordinates (0..1), so the tracker works
// for any video size.
export class Tracker {
  tracks = [];
  #nextId = 1;

  // Returns how many new objects appeared.
  update(dets) {
    const used = new Set();
    for (const t of this.tracks) {
      let best = -1;
      let bestIou = CONFIG.matchIou;
      dets.forEach((d, i) => {
        if (used.has(i) || d.name !== t.name) return;
        const o = iou(t, d);
        if (o > bestIou) {
          bestIou = o;
          best = i;
        }
      });
      if (best >= 0) {
        const d = dets[best];
        const k = CONFIG.smoothing;
        used.add(best);
        t.x += (d.x - t.x) * k;
        t.y += (d.y - t.y) * k;
        t.w += (d.w - t.w) * k;
        t.h += (d.h - t.h) * k;
        t.score = d.score;
        t.hits++;
        t.missed = 0;
      } else t.missed++;
    }
    let added = 0;
    dets.forEach((d, i) => {
      if (used.has(i)) return;
      this.tracks.push({ id: this.#nextId++, ...d, hits: 1, missed: 0, color: colorFor(d.name) });
      added++;
    });
    this.tracks = this.tracks.filter((t) => t.missed <= CONFIG.keepFrames);
    return added;
  }

  // Confirmed boxes, big ones first so small ones are drawn on top.
  visible() {
    return this.tracks
      .filter((t) => t.hits >= CONFIG.confirmFrames && t.missed <= 2)
      .sort((a, b) => b.w * b.h - a.w * a.h);
  }

  clear() {
    this.tracks = [];
  }
}

// The same category always gets the same color.
function colorFor(name) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return CONFIG.palette[h % CONFIG.palette.length];
}

export function iou(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return 0;
  const inter = w * h;
  return inter / (a.w * a.h + b.w * b.h - inter);
}
