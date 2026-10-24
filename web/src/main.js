import * as THREE from 'three';
import { CONFIG } from './config.js';
import { createDetector, detect } from './detector.js';
import { Tracker } from './tracker.js';
import { drawTracks } from './draw.js';
import { startCamera } from './camera.js';

// Quest 3 has no eye-tracking cameras, and the Quest browser doesn't expose eye gaze to
// WebXR on any headset. The gaze dot therefore follows the head: it sits where the centre
// of your view meets a real surface (WebXR hit-test), or CONFIG.overlayDistance ahead.
const DOT_SIZE = 0.012; // relative to distance, so the dot keeps the same size on screen
const DOT_COLOR = 0xff2020;
const CALIBRATION_KEY = 'overlayCalibration';
const CALIBRATION_FIELDS = ['cameraHFov', 'cameraYaw', 'cameraPitch'];

try {
  Object.assign(CONFIG, JSON.parse(localStorage.getItem(CALIBRATION_KEY)));
} catch {}

const $ = (id) => document.getElementById(id);
const msg = (text) => ($('msg').textContent = text);

// --- Detection --------------------------------------------------------------

let detector = null;
let video = null;
let lastVideoTime = -1;
let lastDetect = 0;
let detectMs = 0;
let tracks = [];
const tracker = new Tracker();

// The picture the detector sees, scaled down to CONFIG.detectWidth.
const frame = document.createElement('canvas');
const fctx = frame.getContext('2d', { willReadFrequently: true });

// The camera picture with the boxes drawn on, as in object_recog, shown full screen
// outside AR (on a phone, this is the overlay).
const view = document.createElement('canvas');
const vctx = view.getContext('2d');
const out = $('view');
const octx = out.getContext('2d');

createDetector().then(
  (d) => {
    detector = d;
    msg(video ? 'Object model ready.' : 'Object model ready. Start the camera.');
  },
  (err) => {
    console.error(err);
    msg(`Model error: ${err.message}`);
  },
);

// Phones show the camera picture full screen with the boxes, which lines up exactly with
// what you see. Headsets (Quest) also get "Start AR", with the boxes over the passthrough.
const isPhone = /Android|iPhone|iPad/.test(navigator.userAgent) && !/OculusBrowser|Quest/.test(navigator.userAgent);

$('start-camera').addEventListener('click', async () => {
  const button = $('start-camera');
  button.disabled = true;
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

// Detects on every new camera frame (or at most every CONFIG.detectEveryMs).
function runDetection() {
  if (!detector || !video || video.readyState < 2 || !video.videoWidth) return false;
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
  tracker.update(detect(detector, frame, fw, fh));
  detectMs += (performance.now() - start - detectMs) * 0.2;
  tracks = tracker.visible();
  return true;
}

// The camera picture with the boxes, for the flat screen.
function drawView() {
  if (view.width !== video.videoWidth || view.height !== video.videoHeight) {
    view.width = video.videoWidth;
    view.height = video.videoHeight;
  }
  vctx.drawImage(video, 0, 0, view.width, view.height);
  drawTracks(vctx, tracks, view.width, view.height);
}

// Fits the composed frame into the window.
function present() {
  const W = out.width;
  const H = out.height;
  octx.fillStyle = '#000';
  octx.fillRect(0, 0, W, H);
  const k = Math.min(W / view.width, H / view.height);
  const dw = view.width * k;
  const dh = view.height * k;
  octx.drawImage(view, (W - dw) / 2, (H - dh) / 2, dw, dh);
}

// --- Scene ------------------------------------------------------------------

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 100);
scene.add(camera); // the overlay is a child of the camera, so it follows the head

// Transparent clear so the passthrough shows through in immersive-ar. The canvas itself
// is never shown: outside AR the 2D view is, and in AR the headset composites the frames.
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setClearColor(0x000000, 0);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
renderer.domElement.hidden = true;
document.body.appendChild(renderer.domElement);

// --- 2D overlay -------------------------------------------------------------

// What you see in AR is treated as a flat picture: the boxes are drawn in camera-picture
// coordinates on a canvas, and that canvas is shown head-locked in front of you, sized and
// shifted so the camera picture covers the same part of your view as the real world.
// The pivot turns by the calibrated yaw/pitch; the plane sits at the gaze distance so its
// stereo depth roughly matches what you're looking at.
const overlayCanvas = document.createElement('canvas');
overlayCanvas.width = 1280;
overlayCanvas.height = 960;
const overlayCtx = overlayCanvas.getContext('2d');
const overlayTexture = new THREE.CanvasTexture(overlayCanvas);
overlayTexture.colorSpace = THREE.SRGBColorSpace;
const overlay = new THREE.Mesh(
  new THREE.PlaneGeometry(1, 1),
  new THREE.MeshBasicMaterial({ map: overlayTexture, transparent: true, depthTest: false }),
);
overlay.renderOrder = 5;
const overlayPivot = new THREE.Group();
overlayPivot.add(overlay);
overlayPivot.visible = false;
camera.add(overlayPivot);

let calibrating = false;

function drawOverlay() {
  const W = overlayCanvas.width;
  const H = Math.round((W * video.videoHeight) / video.videoWidth);
  if (overlayCanvas.height !== H) {
    overlayCanvas.height = H;
    overlayTexture.dispose(); // reallocate at the new size on the next upload
  }
  overlayCtx.clearRect(0, 0, W, H);
  // In calibration the camera picture shows half-transparent, to line it up with the room.
  if (calibrating) {
    overlayCtx.globalAlpha = 0.5;
    overlayCtx.drawImage(video, 0, 0, W, H);
    overlayCtx.globalAlpha = 1;
  }
  drawTracks(overlayCtx, tracks, W, H);
  overlayTexture.needsUpdate = true;
}

const tx = () => Math.tan(THREE.MathUtils.degToRad(CONFIG.cameraHFov) / 2);

function layoutOverlay() {
  overlayPivot.rotation.set(
    THREE.MathUtils.degToRad(CONFIG.cameraPitch),
    THREE.MathUtils.degToRad(-CONFIG.cameraYaw),
    0,
    'YXZ',
  );
  const d = gazeDistance;
  const width = 2 * d * tx();
  overlay.position.set(0, 0, -d);
  overlay.scale.set(width, (width * video.videoHeight) / video.videoWidth, 1);
}

// The centre of your view in camera-picture coordinates (0..1): where the head ray
// crosses the overlay.
const forward = new THREE.Vector3();
const pivotInverse = new THREE.Quaternion();
function viewCentre() {
  pivotInverse.copy(overlayPivot.quaternion).invert();
  forward.set(0, 0, -1).applyQuaternion(pivotInverse);
  const ty = (tx() * video.videoHeight) / video.videoWidth;
  return { u: 0.5 + forward.x / -forward.z / (2 * tx()), v: 0.5 - forward.y / -forward.z / (2 * ty) };
}

// The object you're looking at: the smallest box that contains the centre of your view.
function lookedAt() {
  const { u, v } = viewCentre();
  return tracks
    .filter((t) => u >= t.x && u <= t.x + t.w && v >= t.y && v <= t.y + t.h)
    .sort((a, b) => a.w * a.h - b.w * b.h)[0];
}

// --- Gaze dot ---------------------------------------------------------------

const dot = new THREE.Sprite(new THREE.SpriteMaterial({ map: circleTexture(), color: DOT_COLOR, depthTest: false }));
dot.renderOrder = 10;
scene.add(dot);

let hitTestSource = null;
let gazeDistance = CONFIG.overlayDistance;
const head = renderer.xr.getCamera();
const headPos = new THREE.Vector3();
const headDir = new THREE.Vector3();
const hitMatrix = new THREE.Matrix4();
const hitPos = new THREE.Vector3();

function updateGaze(frame) {
  head.getWorldPosition(headPos);
  head.getWorldDirection(headDir);

  let target = CONFIG.overlayDistance;
  if (frame && hitTestSource) {
    const pose = frame.getHitTestResults(hitTestSource)[0]?.getPose(renderer.xr.getReferenceSpace());
    if (pose) {
      hitMatrix.fromArray(pose.transform.matrix);
      target = THREE.MathUtils.clamp(hitPos.setFromMatrixPosition(hitMatrix).distanceTo(headPos), 0.3, 5);
    }
  }
  // Eased, so the overlay's stereo depth doesn't jump between surfaces.
  gazeDistance += (target - gazeDistance) * 0.1;
  dot.position.copy(headPos).addScaledVector(headDir, gazeDistance);
  dot.scale.setScalar(gazeDistance * DOT_SIZE);
}

// --- Calibration ------------------------------------------------------------

// The headset camera sits a little off from your eyes and its exact field of view isn't
// exposed, so the overlay is lined up by eye. A (right controller) toggles the calibration
// view, which shows the camera picture half-transparent over the passthrough:
// right thumbstick moves it, left thumbstick up/down makes it bigger or smaller.
const readout = makeTextSprite();
readout.sprite.position.set(0, -0.28, -1);
readout.sprite.scale.set(0.5, 0.125, 1);
camera.add(readout.sprite);
let aWasPressed = false;

function updateCalibration(frame, dt) {
  for (const input of frame?.session.inputSources ?? []) {
    const pad = input.gamepad;
    if (!pad) continue;
    const [, , ax = 0, ay = 0] = pad.axes;
    if (input.handedness === 'right') {
      const aPressed = pad.buttons[4]?.pressed ?? false;
      if (aPressed && !aWasPressed) toggleCalibration();
      aWasPressed = aPressed;
      if (calibrating) {
        if (Math.abs(ax) > 0.2) CONFIG.cameraYaw += ax * dt * 6;
        if (Math.abs(ay) > 0.2) CONFIG.cameraPitch -= ay * dt * 6;
      }
    } else if (input.handedness === 'left' && calibrating && Math.abs(ay) > 0.2) {
      CONFIG.cameraHFov = THREE.MathUtils.clamp(CONFIG.cameraHFov - ay * dt * 10, 30, 130);
    }
  }
  readout.sprite.visible = calibrating;
  if (calibrating) {
    readout.set(
      `FOV ${CONFIG.cameraHFov.toFixed(1)}°  x ${CONFIG.cameraYaw.toFixed(1)}°  y ${CONFIG.cameraPitch.toFixed(1)}°  ` +
        `detect ${Math.round(detectMs)} ms`,
    );
  }
}

function toggleCalibration() {
  calibrating = !calibrating;
  if (calibrating) return;
  try {
    localStorage.setItem(CALIBRATION_KEY, JSON.stringify(Object.fromEntries(CALIBRATION_FIELDS.map((k) => [k, CONFIG[k]]))));
  } catch {}
}

// --- AR session -------------------------------------------------------------

// Quest 3 passthrough: an immersive-ar session with floor-level tracking. hit-test finds
// the distance to what you're looking at (needs Space Setup on the headset). No
// dom-overlay: Quest doesn't support it, so everything in AR is drawn by three.js.
const arButton = $('start-ar');
if (!isPhone) {
  navigator.xr?.isSessionSupported('immersive-ar').then((ok) => {
    arButton.hidden = !ok;
    arButton.disabled = !ok;
  });
}

arButton.addEventListener('click', async () => {
  try {
    const session = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['local-floor'],
      optionalFeatures: ['hit-test'],
    });
    await renderer.xr.setSession(session);
  } catch (err) {
    console.error(err);
    msg(`Could not start AR: ${err.message}`);
  }
});

renderer.xr.addEventListener('sessionstart', async () => {
  const session = renderer.xr.getSession();
  $('panel').hidden = true;
  if (!session.requestHitTestSource) return;
  const viewer = await session.requestReferenceSpace('viewer');
  hitTestSource = await session.requestHitTestSource({ space: viewer }).catch(() => null);
});

renderer.xr.addEventListener('sessionend', () => {
  hitTestSource = null;
  overlayPivot.visible = false;
  if (calibrating) toggleCalibration();
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
  const inAR = renderer.xr.isPresenting;

  if (!inAR) {
    if (detected) {
      drawView();
      present();
    }
    return;
  }

  updateGaze(xrFrame);
  updateCalibration(xrFrame, dt);
  overlayPivot.visible = video?.videoWidth > 0;
  if (overlayPivot.visible) {
    layoutOverlay();
    if (detected || calibrating) drawOverlay();
    const target = lookedAt();
    dot.material.color.set(target?.color ?? DOT_COLOR);
  }
  renderer.render(scene, camera);
});

// --- Helpers ----------------------------------------------------------------

function circleTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(32, 32, 28, 0, Math.PI * 2);
  ctx.fill();
  return new THREE.CanvasTexture(c);
}

function makeTextSprite() {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 256;
  const ctx = c.getContext('2d');
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false }));
  sprite.renderOrder = 10;
  sprite.visible = false;
  let current = null;
  return {
    sprite,
    set(text) {
      if (text === current) return;
      current = text;
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.font = 'bold 52px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const w = Math.min(ctx.measureText(text).width + 64, c.width);
      ctx.fillStyle = 'rgba(0,0,0,.7)';
      ctx.fillRect((c.width - w) / 2, 64, w, 128);
      ctx.fillStyle = '#fff';
      ctx.fillText(text, c.width / 2, 128, c.width - 32);
      texture.needsUpdate = true;
    },
  };
}
