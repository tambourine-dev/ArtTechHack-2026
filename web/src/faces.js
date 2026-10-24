// Faces and expressions, ported from object_face_facemesh_glitch: MediaPipe's face
// landmarker gives a 468-point mesh plus "blendshapes" (muscle-movement scores), which are
// turned into happy / sad / angry / surprised / neutral. Faces are kept in normalised image
// coordinates (0..1), like the object tracks.
import { FaceLandmarker } from '@mediapipe/tasks-vision';
import { CONFIG } from './config.js';
import { visionFileset, withGpuFallback } from './detector.js';
import { drawTag, measureTag } from './draw.js';
import { iou } from './tracker.js';

const MODEL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

export const EMOTIONS = {
  happy: { color: '#ffd800', icon: '😀' },
  sad: { color: '#3b82ff', icon: '😢' },
  angry: { color: '#ff2d2d', icon: '😠' },
  surprised: { color: '#ff9f1a', icon: '😮' },
  neutral: { color: '#e6e6e6', icon: '😐' },
};

export async function createFaceModel() {
  const files = await visionFileset();
  return withGpuFallback((delegate) =>
    FaceLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: MODEL, delegate },
      runningMode: 'VIDEO',
      numFaces: CONFIG.maxFaces,
      outputFaceBlendshapes: true,
    }),
  );
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));

function expressionScores(categories, base) {
  const b = {};
  for (const c of categories) b[c.categoryName] = Math.max(0, c.score - (base?.[c.categoryName] || 0));
  const avg = (l, r) => ((b[l] || 0) + (b[r] || 0)) / 2;
  const g = CONFIG.gain;
  const smile = avg('mouthSmileLeft', 'mouthSmileRight');
  const frown = avg('mouthFrownLeft', 'mouthFrownRight');
  const browDown = avg('browDownLeft', 'browDownRight');
  const squint = avg('eyeSquintLeft', 'eyeSquintRight');
  const sneer = avg('noseSneerLeft', 'noseSneerRight');
  const press = avg('mouthPressLeft', 'mouthPressRight');
  const eyeWide = avg('eyeWideLeft', 'eyeWideRight');
  const browOuter = avg('browOuterUpLeft', 'browOuterUpRight');
  const browInner = b.browInnerUp || 0;
  const jaw = b.jawOpen || 0;
  return {
    happy: clamp01(smile * g.happy),
    sad: clamp01((frown * 1.0 + browInner * 0.4 + (b.mouthShrugLower || 0) * 0.2) * g.sad),
    angry: clamp01((browDown * 0.9 + squint * 0.3 + sneer * 0.4 + press * 0.3) * g.angry),
    surprised: clamp01((jaw * 0.5 + eyeWide * 0.6 + browOuter * 0.4 + browInner * 0.3) * g.surprised),
  };
}

export function currentEmotion(t) {
  let name = 'neutral';
  let val = 0;
  for (const k in t.scores) {
    if (t.scores[k] > val) {
      val = t.scores[k];
      name = k;
    }
  }
  if (val < CONFIG.minEmotion) return { name: 'neutral', strength: 1 - val };
  return { name, strength: val };
}

// Calibration: while people hold a relaxed face, each face's resting blendshape values are
// averaged over 20 frames and then subtracted, so a naturally "frowny" or "smiley" resting
// face stops being misread.
function trackCalib(t) {
  if (!t.calib) return;
  for (const c of t.cats) t.calib.sum[c.categoryName] = (t.calib.sum[c.categoryName] || 0) + c.score;
  if (++t.calib.n >= 20) {
    t.base = {};
    for (const k in t.calib.sum) t.base[k] = t.calib.sum[k] / t.calib.n;
    t.calib = null;
  }
}

export class FaceTracker {
  faces = [];

  // onChange(strength) is called when a face's expression changes (it drives the glitch).
  update(res, onChange) {
    const found = res.faceLandmarks.map((lm, i) => {
      let x0 = 1;
      let y0 = 1;
      let x1 = 0;
      let y1 = 0;
      for (const p of lm) {
        x0 = Math.min(x0, p.x);
        y0 = Math.min(y0, p.y);
        x1 = Math.max(x1, p.x);
        y1 = Math.max(y1, p.y);
      }
      const w = x1 - x0;
      const h = y1 - y0;
      const padX = w * 0.06;
      const padY = h * 0.1;
      return {
        x: x0 - padX,
        y: y0 - padY * 1.5,
        w: w + padX * 2,
        h: h + padY * 2.5,
        cats: res.faceBlendshapes[i]?.categories || [],
        lm,
      };
    });

    const used = new Set();
    for (const t of this.faces) {
      let best = -1;
      let bestIou = 0.15;
      found.forEach((d, i) => {
        if (used.has(i)) return;
        const o = iou(t, d);
        if (o > bestIou) {
          bestIou = o;
          best = i;
        }
      });
      if (best >= 0) {
        const d = found[best];
        const k = 0.6;
        const e = CONFIG.emotionSmoothing;
        used.add(best);
        t.x += (d.x - t.x) * k;
        t.y += (d.y - t.y) * k;
        t.w += (d.w - t.w) * k;
        t.h += (d.h - t.h) * k;
        t.cats = d.cats;
        t.lm = d.lm;
        trackCalib(t);
        const ns = expressionScores(d.cats, t.base);
        for (const key in ns) t.scores[key] += (ns[key] - t.scores[key]) * e;
        t.missed = 0;
      } else t.missed++;
    }
    found.forEach((d, i) => {
      if (!used.has(i)) this.faces.push({ ...d, scores: expressionScores(d.cats, null), base: null, calib: null, missed: 0 });
    });
    this.faces = this.faces.filter((t) => t.missed <= 4);

    // An expression change sets off a pulse in the mesh, which fades over about half a second.
    for (const t of this.faces) {
      const em = currentEmotion(t).name;
      if (t.lastEmo !== em) {
        t.lastEmo = em;
        t.pulse = 1;
        onChange(em === 'angry' ? 1 : 0.6);
      }
      t.pulse = (t.pulse || 0) * 0.93;
    }
  }

  visible() {
    return this.faces.filter((t) => t.missed <= 1);
  }

  calibrate() {
    for (const t of this.faces) if (t.missed === 0) t.calib = { n: 0, sum: {} };
  }

  resetCalibration() {
    for (const t of this.faces) t.base = null;
  }

  clear() {
    this.faces = [];
  }
}

// Face box colored by expression, the mesh, and the tag underneath the box (so it never
// collides with a "person" tag). Draws onto a canvas of w × h pixels.
export function drawFaces(ctx, faces, w, h) {
  const s = w / 640;
  const lw = CONFIG.lineWidth * s;
  for (const t of faces) {
    const em = currentEmotion(t);
    const info = EMOTIONS[em.name];
    if (CONFIG.mesh && t.lm) drawMesh(ctx, t, info, w, h, s);
    ctx.lineJoin = 'miter';
    ctx.lineWidth = lw;
    ctx.strokeStyle = info.color;
    ctx.strokeRect(t.x * w, t.y * h, t.w * w, t.h * h);

    const pct = CONFIG.showPercent ? ` ${Math.round(em.strength * 100)}%` : '';
    const text = t.calib ? 'calibrating... relax your face' : `${info.icon} ${em.name}${pct}`;
    const fs = Math.max(11, 17 * s);
    const tag = measureTag(ctx, text, fs);
    const lx = Math.min(Math.max(t.x * w - lw / 2, 0), Math.max(0, w - tag.width));
    const ly = Math.min(Math.max((t.y + t.h) * h + lw / 2, 0), h - tag.height);
    drawTag(ctx, text, lx, ly, fs, info.color);
  }
}

// The full wireframe, colored by expression, with glowing features and pulsing dots.
let featureLines = null;
function drawMesh(ctx, t, info, w, h, s) {
  if (!featureLines) {
    const F = FaceLandmarker;
    featureLines = [].concat(
      F.FACE_LANDMARKS_FACE_OVAL,
      F.FACE_LANDMARKS_LEFT_EYE,
      F.FACE_LANDMARKS_RIGHT_EYE,
      F.FACE_LANDMARKS_LEFT_EYEBROW,
      F.FACE_LANDMARKS_RIGHT_EYEBROW,
      F.FACE_LANDMARKS_LIPS,
      F.FACE_LANDMARKS_LEFT_IRIS || [],
      F.FACE_LANDMARKS_RIGHT_IRIS || [],
    );
  }
  const lm = t.lm;
  const lines = (conns, width, alpha, color) => {
    ctx.beginPath();
    for (const c of conns) {
      const a = lm[c.start];
      const b = lm[c.end];
      ctx.moveTo(a.x * w, a.y * h);
      ctx.lineTo(b.x * w, b.y * h);
    }
    ctx.globalAlpha = Math.min(1, alpha);
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    ctx.stroke();
  };

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  lines(FaceLandmarker.FACE_LANDMARKS_TESSELATION, Math.max(0.6, 0.5 * s), CONFIG.meshOpacity + 0.35 * t.pulse, info.color);

  if (CONFIG.meshGlow) {
    ctx.shadowColor = info.color;
    ctx.shadowBlur = (6 + 16 * t.pulse) * s;
  }
  lines(featureLines, Math.max(1.2, 1.6 * s), 0.95, '#ffffff');
  ctx.shadowBlur = 0;

  if (CONFIG.meshDots) {
    ctx.beginPath();
    const r = (0.9 + 2.4 * t.pulse) * s;
    for (const p of lm) {
      ctx.moveTo(p.x * w + r, p.y * h);
      ctx.arc(p.x * w, p.y * h, r, 0, 7);
    }
    ctx.globalAlpha = 0.55 + 0.4 * t.pulse;
    ctx.fillStyle = info.color;
    ctx.fill();
  }
  ctx.restore();
}
