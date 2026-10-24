// The glitch effect from object_face_facemesh_glitch. Its strength is a background level,
// plus how busy the scene is, plus short spikes on events (a new object, an expression
// change), plus a sustained boost while someone looks angry. It's applied to what you see
// only, never to what the models analyse.
import { CONFIG } from './config.js';

export class Glitch {
  #spike = 0;

  bump(value) {
    this.#spike = Math.max(this.#spike, value);
  }

  // Strength 0..1 for this frame; dt in seconds, so spikes fade at the same speed at any
  // frame rate (the original lost 10% per frame at about 30 fps).
  strength(dt, count, angry) {
    this.#spike *= Math.pow(0.9, dt * 30);
    const G = CONFIG.glitch;
    if (!G.on) return 0;
    const busy = Math.min(0.25, 0.02 * count);
    return Math.min(1, (G.base + busy + (angry ? 0.45 : 0) + this.#spike) * G.intensity);
  }
}

// Draws the finished picture (`view`) into the output canvas, fitted, with the glitch on
// top. This is the flat-screen version; in AR the same effects run in a shader.
let gTmp = null;
let gScan = null;
export function presentGlitched(octx, out, view, g) {
  const W = out.width;
  const H = out.height;
  const k = Math.min(W / view.width, H / view.height);
  const dw = Math.round(view.width * k);
  const dh = Math.round(view.height * k);
  const x0 = Math.round((W - dw) / 2);
  const y0 = Math.round((H - dh) / 2);
  octx.globalCompositeOperation = 'source-over';
  octx.globalAlpha = 1;
  octx.fillStyle = '#000';
  octx.fillRect(0, 0, W, H);

  const G = CONFIG.glitch;
  if (g < 0.02) {
    octx.drawImage(view, x0, y0, dw, dh);
    return;
  }

  // 1. RGB split: draw the red, green and blue parts of the picture at slightly different positions
  gTmp ??= document.createElement('canvas');
  if (gTmp.width !== dw || gTmp.height !== dh) {
    gTmp.width = dw;
    gTmp.height = dh;
  }
  const tctx = gTmp.getContext('2d');
  const shift = g * 0.012 * dw * (0.6 + Math.random() * 0.8);
  const jy = (Math.random() - 0.5) * g * 4;
  for (const [color, dx, dy] of [['#ff0000', -shift, 0], ['#00ff00', 0, jy * 0.3], ['#0000ff', shift, -jy]]) {
    tctx.globalCompositeOperation = 'source-over';
    tctx.drawImage(view, 0, 0, dw, dh);
    tctx.globalCompositeOperation = 'multiply'; // keeps only this color channel
    tctx.fillStyle = color;
    tctx.fillRect(0, 0, dw, dh);
    octx.globalCompositeOperation = 'lighter'; // channels add back up to the full picture
    octx.drawImage(gTmp, x0 + dx, y0 + dy);
  }
  octx.globalCompositeOperation = 'source-over';

  // 2. Slice shift: random horizontal bands jump sideways
  if (G.slices && Math.random() < g * 0.7) {
    const n = 1 + Math.floor(Math.random() * 4 * g + 1);
    for (let i = 0; i < n; i++) {
      const bh = Math.max(4, Math.round(dh * (0.01 + Math.random() * 0.08)));
      const by = y0 + Math.floor(Math.random() * Math.max(1, dh - bh));
      const off = Math.round((Math.random() - 0.5) * dw * 0.15 * g);
      octx.drawImage(out, x0, by, dw, bh, x0 + off, by, dw, bh);
    }
  }

  // 3. Flashing noise blocks
  if (G.noise) {
    const cnt = Math.floor(g * 10 * Math.random());
    octx.globalAlpha = 0.35;
    for (let i = 0; i < cnt; i++) {
      octx.fillStyle = Math.random() < 0.5 ? '#00ffff' : '#ff00ff';
      octx.fillRect(x0 + Math.random() * dw, y0 + Math.random() * dh, 10 + Math.random() * dw * 0.08, 2 + Math.random() * 8);
    }
    octx.globalAlpha = 1;
  }

  // 4. Scanlines
  if (G.scanlines) {
    if (!gScan) {
      const c = document.createElement('canvas');
      c.width = 1;
      c.height = 4;
      const cx = c.getContext('2d');
      cx.fillStyle = '#000';
      cx.fillRect(0, 0, 1, 2);
      gScan = octx.createPattern(c, 'repeat');
    }
    octx.globalAlpha = 0.12 + 0.25 * g;
    octx.fillStyle = gScan;
    octx.fillRect(x0, y0, dw, dh);
    octx.globalAlpha = 1;
  }

  // 5. Brightness flicker
  if (Math.random() < g * 0.25) {
    octx.globalAlpha = 0.04 + 0.08 * g * Math.random();
    octx.fillStyle = Math.random() < 0.5 ? '#fff' : '#000';
    octx.fillRect(x0, y0, dw, dh);
    octx.globalAlpha = 1;
  }
}

// The same effects for the AR view's fragment shader. `layer(uv)` returns the picture
// (premultiplied); scanlines and flicker only touch pixels that have content, so the
// passthrough around the boxes isn't darkened into a visible rectangle.
export const GLITCH_GLSL = /* glsl */ `
  uniform float glitch;
  uniform float time;
  uniform vec3 glitchParts; // slices, scanlines, noise (1 = on)
  uniform vec4 flicker;     // color and alpha of this frame's brightness flicker

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  vec4 glitched(vec2 uv) {
    float g = glitch;
    float tick = floor(time * 15.0);
    // 1. Slice shift: random horizontal bands jump sideways
    if (glitchParts.x > 0.5) {
      float band = floor(uv.y * 30.0);
      if (hash(vec2(band, tick)) < g * 0.12) uv.x += (hash(vec2(band, tick + 7.0)) - 0.5) * 0.15 * g;
    }
    // 2. RGB split
    float shift = g * 0.012 * (0.6 + 0.8 * hash(vec2(tick, 3.0)));
    vec4 r = layer(uv - vec2(shift, 0.0));
    vec4 gr = layer(uv);
    vec4 b = layer(uv + vec2(shift, 0.0));
    vec4 c = vec4(r.r, gr.g, b.b, max(max(r.a, gr.a), b.a));
    // 3. Flashing noise blocks
    if (glitchParts.z > 0.5) {
      vec2 cell = floor(vec2(uv.x * 12.0, uv.y * 80.0));
      if (hash(cell + tick) < g * 0.01) {
        vec3 n = hash(cell * 1.7 + tick) < 0.5 ? vec3(0.0, 1.0, 1.0) : vec3(1.0, 0.0, 1.0);
        c = vec4(n * 0.35 + c.rgb * 0.65, 0.35 + c.a * 0.65);
      }
    }
    // 4. Scanlines
    if (glitchParts.y > 0.5 && g >= 0.02 && mod(gl_FragCoord.y, 4.0) < 2.0) c.rgb *= 1.0 - (0.12 + 0.25 * g);
    // 5. Brightness flicker
    c.rgb = mix(c.rgb, flicker.rgb * c.a, flicker.a);
    return c;
  }
`;

// This frame's flicker for the shader: a brief white or black wash, as often as in the
// original (which drew at about 30 fps).
export function flickerFor(g, dt, target) {
  if (Math.random() < g * 0.25 * dt * 30) {
    const v = Math.random() < 0.5 ? 1 : 0;
    target.set(v, v, v, 0.04 + 0.08 * g * Math.random());
  } else target.set(0, 0, 0, 0);
}
