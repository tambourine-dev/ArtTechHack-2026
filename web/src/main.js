import * as THREE from 'three';
import { CONFIG } from './config.js';
import { createDetector, detect } from './detector.js';
import { iou, Tracker } from './tracker.js';
import { drawTag, drawTracks } from './draw.js';
import { createFaceModel, currentEmotion, drawFaces, FaceTracker } from './faces.js';
import { flickerFor, Glitch, GLITCH_GLSL, presentGlitched } from './glitch.js';
import { startCamera } from './camera.js';
import { drawStimuli, pickStimuli, stimuli } from './stimuli.js';
import { narrate } from './llm.js';
import { unlockAudio, Voice } from './voice.js';

const CALIBRATION_KEY = 'overlayCalibration';
const CALIBRATION_FIELDS = ['cameraHFov', 'cameraYaw', 'cameraPitch', 'cameraLatencyMs'];

try {
  Object.assign(CONFIG, JSON.parse(localStorage.getItem(CALIBRATION_KEY)));
} catch {}

const $ = (id) => document.getElementById(id);
const msg = (text) => ($('msg').textContent = text);

// --- Detection --------------------------------------------------------------

let detector = null;
let faceModel = null;
let video = null;
let lastVideoTime = -1;
let lastDetect = 0;
let detectMs = 0;
let frameNo = 0;
let tracks = [];
let faces = [];
const tracker = new Tracker();
const faceTracker = new FaceTracker();
const glitch = new Glitch();

// The picture the detector sees, scaled down to CONFIG.detectWidth.
const frame = document.createElement('canvas');
const fctx = frame.getContext('2d', { willReadFrequently: true });

// The camera picture with the boxes drawn on, as in object_recog, shown full screen
// outside AR (on a phone, this is the overlay).
const view = document.createElement('canvas');
const vctx = view.getContext('2d');
const out = $('view');
const octx = out.getContext('2d');

Promise.all([
  CONFIG.objects && createDetector().then((d) => (detector = d)),
  CONFIG.faces && createFaceModel().then((m) => (faceModel = m)),
]).then(
  () => msg(video ? 'Models ready.' : 'Models ready. Start the camera.'),
  (err) => {
    console.error(err);
    msg(`Model error: ${err.message}`);
  },
);

const angryFace = () => faces.some((t) => currentEmotion(t).name === 'angry');
const glitchStrength = (dt) => glitch.strength(dt, tracks.length + faces.length, angryFace());

// Keyboard (flat screen): C = calibrate faces (hold a relaxed face), R = reset that,
// M = face mesh on/off, G = glitch on/off. In AR: X and Y on the left controller.
addEventListener('keydown', (e) => {
  const key = e.key.toLowerCase();
  if (key === 'c') faceTracker.calibrate();
  if (key === 'r') faceTracker.resetCalibration();
  if (key === 'm') CONFIG.mesh = !CONFIG.mesh;
  if (key === 'g') CONFIG.glitch.on = !CONFIG.glitch.on;
});

// Phones show the camera picture full screen with the boxes, which lines up exactly with
// what you see. Headsets (Quest) also get "Start AR", with the boxes over the passthrough.
const isPhone = /Android|iPhone|iPad/.test(navigator.userAgent) && !/OculusBrowser|Quest/.test(navigator.userAgent);

$('start-camera').addEventListener('click', async () => {
  const button = $('start-camera');
  button.disabled = true;
  unlockAudio();
  try {
    msg('Starting camera…');
    video = await startCamera();
    lastVideoTime = -1;
    button.hidden = true;
    if (isPhone) $('panel').hidden = true;
    msg('Camera on. Start AR when ready.');
  } catch (err) {
    console.error(err);
    button.disabled = false;
    msg(`Camera unavailable: ${err.message}. On Quest, allow "headset cameras" for the browser.`);
  }
});

// Runs the models on every new camera frame (or at most every CONFIG.detectEveryMs): faces
// every frame, objects every CONFIG.objectEvery frames.
function runDetection() {
  if ((!detector && !faceModel) || !video || video.readyState < 2 || !video.videoWidth) return false;
  if (video.currentTime === lastVideoTime) return false; // no new camera frame yet
  if (performance.now() - lastDetect < CONFIG.detectEveryMs) return false;
  lastVideoTime = video.currentTime;
  lastDetect = performance.now();

  const fw = Math.min(CONFIG.detectWidth, video.videoWidth);
  const fh = Math.round((fw * video.videoHeight) / video.videoWidth);
  if (frame.width !== fw || frame.height !== fh) {
    frame.width = fw;
    frame.height = fh;
  }
  fctx.drawImage(video, 0, 0, fw, fh);
  const start = performance.now();
  if (detector && frameNo % CONFIG.objectEvery === 0) {
    if (tracker.update(detect(detector, frame, fw, fh)) > 0) glitch.bump(0.3);
    tracks = tracker.visible();
  }
  if (faceModel) {
    faceTracker.update(faceModel.detectForVideo(frame, performance.now()), (v) => glitch.bump(v));
    faces = faceTracker.visible();
  }
  frameNo++;
  detectMs += (performance.now() - start - detectMs) * 0.2;
  return true;
}

// The camera picture with the boxes and faces, for the flat screen.
function drawView() {
  if (view.width !== video.videoWidth || view.height !== video.videoHeight) {
    view.width = video.videoWidth;
    view.height = video.videoHeight;
  }
  vctx.drawImage(video, 0, 0, view.width, view.height);
  drawTracks(vctx, pickStimuli(tracks), view.width, view.height);
  drawFaces(vctx, pickStimuli(faces), view.width, view.height);
  drawAsking(vctx, view.width);
  drawStimuli(vctx, view.width);
}

// Fits the composed frame into the window, with the glitch on top.
let lastPresent = performance.now();
function present() {
  const now = performance.now();
  presentGlitched(octx, out, view, glitchStrength((now - lastPresent) / 1000));
  lastPresent = now;
}

// --- Asking about objects --------------------------------------------------

// Whatever you look at for CONFIG.dwellMs (a box, or with CONFIG.describeScene the whole
// scene when you look at no box) starts the main narration: a crop goes to the LLM, which
// keeps talking about it, searching the web for more, for as long as you keep looking.
// Settling on something else for CONFIG.switchMs switches to it: the sentence being spoken
// finishes, the queued ones are dropped, and the new target starts over.
// With the stimuli slider high, the biggest other shown boxes get narrations of their own
// at the same time (see maxNarrations). Each narration has its own voice, panned and set
// in volume by where its box is (see placeVoices).
// Where boxes overlap, lookedAt() picks the smallest.
let gazeId = null; // what the gaze is on now: a track id, 'scene', or null
let gazeSince = 0;
let primary = null; // the narration of what you look at
let extras = []; // narrations of other boxes
// A narration: { id, trackId, name, box, voice, abort, waiting, done, lostAt }

const maxNarrations = () => (stimuli.percent >= 80 ? 3 : stimuli.percent >= 50 ? 2 : 1);
const narrations = () => (primary ? [primary, ...extras] : extras);

// The tracker sometimes loses a box and finds it again under a new id; a box of the same
// kind where the narrated one was still counts as the narrated object.
const matches = (track, n) =>
  track.id === n.trackId || (n.box && track.name === n.name && iou(track, n.box) > 0.3);

function gazeTarget(track) {
  if (!track) return CONFIG.describeScene ? 'scene' : null;
  if (primary && matches(track, primary)) return primary.id;
  return track.id;
}

function updateGaze(track, now) {
  const id = gazeTarget(track);
  if (id !== gazeId) {
    gazeId = id;
    gazeSince = now;
  }
  if (!CONFIG.ask || id === (primary?.id ?? null)) return;
  if (now - gazeSince < (primary && !primary.done ? CONFIG.switchMs : CONFIG.dwellMs)) return;
  stopNarration(primary);
  primary = null;
  if (id === null) return;
  // A box that already has a narration of its own carries on as the main one.
  const extra = track && extras.find((n) => matches(track, n));
  if (extra) {
    extras = extras.filter((n) => n !== extra);
    extra.id = id;
    primary = extra;
  } else primary = startNarration(id, track);
}

// Keeps the extra narrations on the biggest shown boxes, up to maxNarrations() - 1. A box
// must have been around for CONFIG.dwellMs to get one, and one that drops out of the
// biggest for CONFIG.switchMs loses it.
function updateExtras(now) {
  const want = CONFIG.ask ? maxNarrations() - 1 : 0;
  for (const t of tracks) t.seenAt ??= now;
  const candidates = pickStimuli(tracks)
    .filter((t) => !(primary && matches(t, primary)) && now - t.seenAt >= CONFIG.dwellMs)
    .sort((a, b) => b.w * b.h - a.w * a.h)
    .slice(0, want);
  for (const n of extras) n.lostAt = candidates.some((t) => matches(t, n)) ? 0 : n.lostAt || now;
  extras = extras.filter((n, i) => {
    const keep = i < want && !(n.lostAt && now - n.lostAt > CONFIG.switchMs);
    if (!keep) stopNarration(n);
    return keep;
  });
  for (const t of candidates) {
    if (extras.length >= want) break;
    if (!extras.some((n) => matches(t, n))) extras.push(startNarration(t.id, t));
  }
}

// Pan from how far left or right of the gaze centre a box is; volume from its size (bigger
// is nearer, so louder), lowered the further it is from the centre. centre is in camera
// picture coordinates (0..1).
function placeVoices(centre) {
  for (const n of narrations()) {
    const t = n.trackId != null && tracks.find((t) => matches(t, n));
    if (t) {
      n.trackId = t.id;
      n.box = { x: t.x, y: t.y, w: t.w, h: t.h };
    }
    if (!n.box) {
      n.voice.place(0, 1); // the whole scene
      continue;
    }
    const du = n.box.x + n.box.w / 2 - centre.u;
    const dv = n.box.y + n.box.h / 2 - centre.v;
    const size = THREE.MathUtils.clamp(Math.sqrt(n.box.w * n.box.h) * 2.5, 0.3, 1);
    const off = Math.min(1, Math.hypot(du, dv) / 0.6);
    n.voice.place(THREE.MathUtils.clamp(du / 0.4, -1, 1), size * (1 - 0.6 * off));
  }
}

// Cancels the LLM request and drops the queued sentences; the sentence being spoken
// finishes, unless hard is set (leaving AR).
function stopNarration(n, hard = false) {
  if (!n) return;
  n.abort.abort();
  if (hard) n.voice.stop();
  else n.voice.clear();
  n.voice.release();
}

function stopAllNarrations() {
  for (const n of narrations()) stopNarration(n, true);
  primary = null;
  extras = [];
}

function startNarration(id, track) {
  const n = {
    id,
    trackId: track?.id ?? null,
    name: track?.name ?? 'the scene',
    box: track && { x: track.x, y: track.y, w: track.w, h: track.h },
    voice: new Voice(),
    abort: new AbortController(),
    waiting: true,
    done: false,
    lostAt: 0,
  };
  runNarration(n, track);
  return n;
}

async function runNarration(n, track) {
  const image = cropOf(track ?? { x: 0, y: 0, w: 1, h: 1 });
  // While one turn is spoken the next is generated, but no further ahead than that.
  let lastSentence = Promise.resolve();
  let previousTurn = Promise.resolve();
  try {
    msg(`Looking at ${n.name}…`);
    for await (const part of narrate(image, track?.name ?? null, n.abort.signal)) {
      if (n.abort.signal.aborted) break;
      if (part.end) {
        await previousTurn;
        previousTurn = lastSentence;
        continue;
      }
      n.waiting = false;
      console.log(`[llm] ${n.name} (${n.voice.name}):`, part.sentence);
      msg(part.sentence);
      lastSentence = n.voice.say(part.sentence);
    }
  } catch (err) {
    if (n.abort.signal.aborted) return;
    console.error(err);
    msg(`LLM error: ${err.message}`);
  }
  // Ran out of things to say: it stays (silent) until you look away, so it isn't restarted.
  if (!n.abort.signal.aborted) n.done = true;
}

// The box (plus a margin) cut out of the full-resolution camera picture, as a JPEG data URL.
const crop = document.createElement('canvas');
function cropOf(t) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const pad = 0.1;
  const x0 = Math.max(0, (t.x - t.w * pad) * vw);
  const y0 = Math.max(0, (t.y - t.h * pad) * vh);
  const x1 = Math.min(vw, (t.x + t.w * (1 + pad)) * vw);
  const y1 = Math.min(vh, (t.y + t.h * (1 + pad)) * vh);
  const s = CONFIG.askImageSize / Math.max(x1 - x0, y1 - y0, 1);
  crop.width = Math.max(1, Math.round((x1 - x0) * s));
  crop.height = Math.max(1, Math.round((y1 - y0) * s));
  crop.getContext('2d').drawImage(video, x0, y0, x1 - x0, y1 - y0, 0, 0, crop.width, crop.height);
  return crop.toDataURL('image/jpeg', 0.85);
}

// "thinking about cup…" at the top of the picture until a narration's first sentence arrives.
function drawAsking(ctx, w) {
  const names = narrations().filter((n) => n.waiting && !n.done && !n.abort.signal.aborted).map((n) => n.name);
  if (!names.length) return;
  const fs = Math.max(14, 22 * (w / 640));
  drawTag(ctx, `thinking about ${names.join(', ')}…`, fs, fs, fs, '#ffffff');
}

// --- AR view ----------------------------------------------------------------

// In AR the boxes are shown over the passthrough as one flat 2D image, the same layout as
// the browser view but without the camera picture (unless in setup mode or
// CONFIG.arShowCamera). Both eyes get the identical image (the vertex shader skips the
// per-eye view matrix), so it's never placed at a depth in the 3D scene; it covers the part
// of your view the camera sees. CONFIG.cameraHFov/Yaw/Pitch line it up with the room.
//
// The boxes come from a camera frame that is already old (camera delay plus detection
// time), so the image is turned by how far the head has rotated since that frame was
// taken. It stays a flat 2D image; it just shifts the way the world did.
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 100);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setClearColor(0x000000, 0);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local');
renderer.domElement.hidden = true; // outside AR the 2D canvas is shown instead
document.body.appendChild(renderer.domElement);

// The boxes are drawn on their own transparent canvas, only when they change; the camera
// picture is uploaded straight from the video element.
const boxCanvas = document.createElement('canvas');
const boxCtx = boxCanvas.getContext('2d');
const boxTexture = new THREE.CanvasTexture(boxCanvas);
let videoTexture = null;
let lastUploadTime = -1;

const arView = new THREE.Mesh(
  new THREE.PlaneGeometry(1, 1),
  new THREE.ShaderMaterial({
    uniforms: {
      videoMap: { value: null },
      boxMap: { value: boxTexture },
      opacity: { value: 1 },
      glitch: { value: 0 },
      time: { value: 0 },
      glitchParts: { value: new THREE.Vector3() },
      flicker: { value: new THREE.Vector4() },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * vec4(position, 1.0); // head-locked, same in both eyes
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D videoMap;
      uniform sampler2D boxMap;
      uniform float opacity;
      varying vec2 vUv;
      // The picture (camera in setup mode, boxes and faces on top), premultiplied.
      vec4 layer(vec2 uv) {
        vec4 v = texture2D(videoMap, uv);
        vec4 b = texture2D(boxMap, uv);
        float a = max(opacity, b.a);
        return vec4(mix(v.rgb, b.rgb, b.a) * a, a);
      }
      ${GLITCH_GLSL}
      void main() {
        vec4 c = glitched(vUv);
        gl_FragColor = c.a > 0.0 ? vec4(c.rgb / c.a, c.a) : vec4(0.0);
      }`,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  }),
);
arView.frustumCulled = false;
arView.visible = false;
scene.add(arView);

// Ring at the centre of your view, in the color of the box you're looking at. Head-locked
// with the same projection-only shader, so it's flat too.
const ring = new THREE.Mesh(
  new THREE.PlaneGeometry(0.03, 0.03).translate(0, 0, -1),
  new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color() } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 color;
      varying vec2 vUv;
      void main() {
        float d = length(vUv - 0.5) * 2.0;
        gl_FragColor = vec4(color, smoothstep(0.62, 0.7, d) * (1.0 - smoothstep(0.92, 1.0, d)));
      }`,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  }),
);
ring.frustumCulled = false;
ring.renderOrder = 1;
scene.add(ring);

// Recent head orientations, to look up where the head pointed when a frame was taken.
const headHistory = [];
const headNow = new THREE.Quaternion();
const headAtCapture = new THREE.Quaternion();
const headDelta = new THREE.Quaternion(); // capture view → current view
let hasCapture = false;

function recordHead(xrFrame) {
  const pose = xrFrame?.getViewerPose(renderer.xr.getReferenceSpace());
  if (!pose) return;
  const { x, y, z, w } = pose.transform.orientation;
  headNow.set(x, y, z, w);
  const now = performance.now();
  headHistory.push({ t: now, q: headNow.clone() });
  while (headHistory.length && headHistory[0].t < now - 1000) headHistory.shift();
}

function headAt(t) {
  let best = headHistory[headHistory.length - 1];
  for (const entry of headHistory) if (Math.abs(entry.t - t) < Math.abs(best.t - t)) best = entry;
  return best.q;
}

const cameraRotation = new THREE.Quaternion();
const euler = new THREE.Euler();
const corner = new THREE.Vector3();

// Places the picture's corners 1 m in front of the eyes, covering the camera's FOV, turned
// by the head rotation since the frame was taken.
function layoutARView() {
  if (!hasCapture) headAtCapture.copy(headNow);
  headDelta.copy(headNow).invert().multiply(headAtCapture);
  euler.set(THREE.MathUtils.degToRad(CONFIG.cameraPitch), THREE.MathUtils.degToRad(-CONFIG.cameraYaw), 0, 'YXZ');
  cameraRotation.setFromEuler(euler);
  const tx = Math.tan(THREE.MathUtils.degToRad(CONFIG.cameraHFov) / 2);
  const ty = (tx * video.videoHeight) / video.videoWidth;
  const position = arView.geometry.attributes.position;
  // PlaneGeometry's vertex order: top-left, top-right, bottom-left, bottom-right.
  [[-tx, ty], [tx, ty], [-tx, -ty], [tx, -ty]].forEach(([x, y], i) => {
    corner.set(x, y, -1).applyQuaternion(cameraRotation).applyQuaternion(headDelta);
    position.setXYZ(i, corner.x, corner.y, corner.z);
  });
  position.needsUpdate = true;
}

// The centre of your view in camera-picture coordinates (0..1).
const forward = new THREE.Vector3();
function viewCentre() {
  forward.set(0, 0, -1).applyQuaternion(headDelta.clone().invert()).applyQuaternion(cameraRotation.clone().invert());
  const tx = Math.tan(THREE.MathUtils.degToRad(CONFIG.cameraHFov) / 2);
  const ty = (tx * video.videoHeight) / video.videoWidth;
  return { u: 0.5 + forward.x / -forward.z / (2 * tx), v: 0.5 - forward.y / -forward.z / (2 * ty) };
}

// Quest 3 has no eye tracking, and the Quest browser doesn't expose eye gaze to WebXR on
// any headset, so "looking at" means the centre of your view (head gaze). The object you
// look at is the smallest box containing it.
function lookedAt({ u, v }) {
  return tracks
    .filter((t) => u >= t.x && u <= t.x + t.w && v >= t.y && v <= t.y + t.h)
    .sort((a, b) => a.w * a.h - b.w * b.h)[0];
}

function drawBoxes() {
  const W = 1280;
  const H = Math.round((W * video.videoHeight) / video.videoWidth);
  if (boxCanvas.width !== W || boxCanvas.height !== H) {
    boxCanvas.width = W;
    boxCanvas.height = H;
    boxTexture.dispose(); // reallocate at the new size on the next upload
  }
  boxCtx.clearRect(0, 0, W, H);
  drawTracks(boxCtx, pickStimuli(tracks), W, H);
  drawFaces(boxCtx, pickStimuli(faces), W, H);
  drawAsking(boxCtx, W);
  drawStimuli(boxCtx, W);

  if (calibrating) {
    const text =
      `FOV ${CONFIG.cameraHFov.toFixed(1)}°  x ${CONFIG.cameraYaw.toFixed(1)}°  ` +
      `y ${CONFIG.cameraPitch.toFixed(1)}°  lag ${Math.round(CONFIG.cameraLatencyMs)} ms  ` +
      `detect ${Math.round(detectMs)} ms`;
    boxCtx.font = 'bold 36px system-ui, sans-serif';
    const w = boxCtx.measureText(text).width + 40;
    boxCtx.fillStyle = 'rgba(0,0,0,.7)';
    boxCtx.fillRect((W - w) / 2, H - 120, w, 60);
    boxCtx.fillStyle = '#fff';
    boxCtx.textAlign = 'center';
    boxCtx.textBaseline = 'middle';
    boxCtx.fillText(text, W / 2, H - 90);
    boxCtx.textAlign = 'start';
  }
  boxTexture.needsUpdate = true;
}

// Uploads a new camera frame to the GPU. Done by hand rather than with THREE.VideoTexture,
// which relies on requestVideoFrameCallback and may not fire during an immersive session.
function uploadVideoFrame() {
  if (!videoTexture) {
    videoTexture = new THREE.Texture(video);
    videoTexture.minFilter = THREE.LinearFilter;
    videoTexture.generateMipmaps = false;
    arView.material.uniforms.videoMap.value = videoTexture;
  }
  if (video.currentTime === lastUploadTime) return;
  lastUploadTime = video.currentTime;
  videoTexture.needsUpdate = true;
}

// --- Calibration ------------------------------------------------------------

// The headset camera sits a little off from your eyes and its exact field of view isn't
// exposed, so the boxes are lined up with the room by eye. A (right controller) toggles
// setup mode: the camera picture shows half-transparent over the passthrough, the right
// thumbstick moves it (and the boxes), and the left thumbstick up/down scales it.
// Left thumbstick left/right sets the camera lag: shake your head and tune it until the
// picture stays put on the room instead of swinging after it.
let calibrating = false;
const wasPressed = {};

// True only on the frame a controller button goes down.
function pressedOnce(input, index) {
  const key = `${input.handedness}${index}`;
  const pressed = input.gamepad.buttons[index]?.pressed ?? false;
  const once = pressed && !wasPressed[key];
  wasPressed[key] = pressed;
  return once;
}

function updateCalibration(frame, dt) {
  let changed = false;
  for (const input of frame?.session.inputSources ?? []) {
    const pad = input.gamepad;
    if (!pad) continue;
    const [, , ax = 0, ay = 0] = pad.axes;
    if (input.handedness === 'right') {
      if (pressedOnce(input, 4)) {
        toggleCalibration();
        changed = true;
      }
      if (calibrating && Math.abs(ax) > 0.2) CONFIG.cameraYaw += ax * dt * 6;
      if (calibrating && Math.abs(ay) > 0.2) CONFIG.cameraPitch -= ay * dt * 6;
      changed ||= calibrating && (Math.abs(ax) > 0.2 || Math.abs(ay) > 0.2);
    } else if (input.handedness === 'left') {
      // X = calibrate faces (hold a relaxed face), Y = glitch on/off.
      if (pressedOnce(input, 4)) faceTracker.calibrate();
      if (pressedOnce(input, 5)) CONFIG.glitch.on = !CONFIG.glitch.on;
      if (calibrating) {
        if (Math.abs(ay) > 0.2) CONFIG.cameraHFov = THREE.MathUtils.clamp(CONFIG.cameraHFov - ay * dt * 10, 30, 130);
        if (Math.abs(ax) > 0.2) CONFIG.cameraLatencyMs = THREE.MathUtils.clamp(CONFIG.cameraLatencyMs + ax * dt * 60, 0, 400);
        changed ||= Math.abs(ax) > 0.2 || Math.abs(ay) > 0.2;
      }
    }
  }
  arView.material.uniforms.opacity.value = calibrating ? 0.5 : CONFIG.arShowCamera ? 1 : 0;
  return changed;
}

function toggleCalibration() {
  calibrating = !calibrating;
  if (calibrating) return;
  try {
    localStorage.setItem(CALIBRATION_KEY, JSON.stringify(Object.fromEntries(CALIBRATION_FIELDS.map((k) => [k, CONFIG[k]]))));
  } catch {}
}

// --- AR session -------------------------------------------------------------

// Quest 3 passthrough: an immersive-ar session. No dom-overlay (Quest doesn't support it),
// so everything in AR is drawn through three.js.
const arButton = $('start-ar');
if (!isPhone) {
  navigator.xr?.isSessionSupported('immersive-ar').then((ok) => {
    arButton.hidden = !ok;
    arButton.disabled = !ok;
  });
}

arButton.addEventListener('click', async () => {
  unlockAudio();
  try {
    await renderer.xr.setSession(await navigator.xr.requestSession('immersive-ar'));
  } catch (err) {
    console.error(err);
    msg(`Could not start AR: ${err.message}`);
  }
});

renderer.xr.addEventListener('sessionstart', () => ($('panel').hidden = true));
renderer.xr.addEventListener('sessionend', () => {
  arView.visible = false;
  hasCapture = false;
  headHistory.length = 0;
  if (calibrating) toggleCalibration();
  stopAllNarrations();
  gazeId = null;
  $('panel').hidden = false;
});

// --- Loop -------------------------------------------------------------------

function resize() {
  out.width = innerWidth * devicePixelRatio;
  out.height = innerHeight * devicePixelRatio;
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}
addEventListener('resize', resize);
resize();

let lastTime = performance.now();
renderer.setAnimationLoop((time, xrFrame) => {
  const now = performance.now();
  const dt = (now - lastTime) / 1000;
  lastTime = now;
  const detected = runDetection();

  if (!renderer.xr.isPresenting) {
    // On the flat screen there's no head, so "looking at" means the centre of the picture.
    if (video) {
      updateGaze(lookedAt({ u: 0.5, v: 0.5 }), now);
      updateExtras(now);
      placeVoices({ u: 0.5, v: 0.5 });
    }
    if (detected) {
      drawView();
      present();
    }
    return;
  }

  recordHead(xrFrame);
  arView.visible = ring.visible = video?.videoWidth > 0 && headHistory.length > 0;
  if (arView.visible) {
    // The detection that just ran used a frame taken about cameraLatencyMs before it started.
    if (detected) {
      headAtCapture.copy(headAt(lastDetect - CONFIG.cameraLatencyMs));
      hasCapture = true;
    }
    const changed = updateCalibration(xrFrame, dt);
    layoutARView();
    const u = arView.material.uniforms;
    u.glitch.value = glitchStrength(dt);
    u.time.value = now / 1000;
    u.glitchParts.value.set(+CONFIG.glitch.slices, +CONFIG.glitch.scanlines, +CONFIG.glitch.noise);
    flickerFor(u.glitch.value, dt, u.flicker.value);
    const centre = viewCentre();
    const looked = lookedAt(centre);
    updateGaze(looked, now);
    updateExtras(now);
    placeVoices(centre);
    ring.material.uniforms.color.value.setStyle(looked?.color ?? '#ff2020', THREE.LinearSRGBColorSpace);
    if (arView.material.uniforms.opacity.value > 0) uploadVideoFrame();
    if (detected || changed || calibrating) drawBoxes();
  }
  renderer.render(scene, camera);
});
