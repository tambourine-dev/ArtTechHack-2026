// The share of boxes that reach the participant, set with the slider on the control page
// (control.html, opened on the computer) and fetched from the dev server twice a second.
import { drawTag, measureTag } from './draw.js';

export const stimuli = { percent: 100 };

async function poll() {
  try {
    const res = await fetch('/stimuli');
    stimuli.percent = (await res.json()).percent;
  } catch {}
  setTimeout(poll, 500);
}
poll();

// Keeps that share of the boxes (objects or faces). Each box gets a random rank when first
// seen and keeps it, so the same boxes stay shown instead of flickering.
export function pickStimuli(list) {
  const keep = Math.round((list.length * stimuli.percent) / 100);
  if (keep >= list.length) return list;
  for (const t of list) t.stimulusRank ??= Math.random();
  const chosen = new Set([...list].sort((a, b) => a.stimulusRank - b.stimulusRank).slice(0, keep));
  return list.filter((t) => chosen.has(t));
}

// "stimuli 40%" in the top right corner of the picture.
export function drawStimuli(ctx, w) {
  const fs = Math.max(14, 22 * (w / 640));
  const text = `stimuli ${Math.round(stimuli.percent)}%`;
  drawTag(ctx, text, w - measureTag(ctx, text, fs).width - fs, fs, fs, '#ffffff');
}
