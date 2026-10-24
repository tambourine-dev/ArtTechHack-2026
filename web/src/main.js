import * as THREE from 'three';
import { CONFIG } from './config.js';
import { createDetector, detect } from './detector.js';
import { Tracker } from './tracker.js';
import { drawTracks } from './draw.js';
import { WorldBoxes } from './boxes3d.js';
import { startHeadsetCamera, startPhoneReceiver } from './sources.js';

// Quest 3 has no eye-tracking cameras, and the Quest browser doesn't expose eye gaze to
// WebXR on any headset. The gaze dot therefore follows the head: it sits where the centre
// of your view meets a real surface (WebXR hit-test), or CONFIG.boxDistance ahead.
const DOT_SIZE = 0.012; // relative to distance, so the dot keeps the same size on screen
const CALIBRATION_KEY = 'cameraCalibration';

try {
  Object.assign(CONFIG, JSON.parse(localStorage.getItem(CALIBRATION_KEY)));
} catch {}

const $ = (id) => document.getElementById(id);
const msg = (text) => ($('msg').textContent = text);

// --- Detection --------------------------------------------------------------

let detector = null;
let video = null;
let source = null; // 'headset' | 'phone'
let lastVideoTime = -1;
let lastDetect = 0;
const tracker = new Tracker();

// The camera picture with the boxes drawn on, as in object_recog. Shown full screen
// outside AR, and on a floating panel in AR when the camera is a phone.
const view = document.createElement('canvas');
const vctx = view.getContext('2d');
const out = $('view');
const octx = out.getContext('2d');

createDetector().then(
  (d) => {
    detector = d;
    msg(video ? 'Object model ready.' : 'Object model ready. Choose a camera.');
  },
  (err) => {
    console.error(err);
    msg(`Model error: ${err.message}`);
  },
);

function useSource(name, v) {
  source = name;
  video = v;
  lastVideoTime = -1;
  tracker.clear();
  worldBoxes.clear();
  $('use-headset').disabled = $('use-phone').disabled = true;
}

$('use-headset').addEventListener('click', async () => {
  try {
    msg('Starting headset camera…');
    useSource('headset', await startHeadsetCamera());
    msg('Headset camera on. Start AR when ready.');
  } catch (err) {
    console.error(err);
    msg(`Camera unavailable: ${err.message}. Allow "headset cameras" for the browser, or use the phone.`);
  }
});

$('use-phone').addEventListener('click', () => {
  useSource(
    'phone',
    startPhoneReceiver({
      onCode(code, link) {
        $('pairing').hidden = false;
        $('code').textContent = code;
        $('link').textContent = link;
        msg('Waiting for the phone…');
      },
      onConnected: () => msg('Phone connected. Start AR when ready.'),
      onDisconnected: () => msg('Phone disconnected.'),
      onError: (e) => msg(`Connection error: ${e.type}`),
    }),
  );
});

function runDetection() {
  if (!detector || !video || video.readyState < 2 || !video.videoWidth) return;
  if (video.currentTime === lastVideoTime) return; // no new camera frame yet
  if (performance.now() - lastDetect < CONFIG.detectEveryMs) return;
  lastVideoTime = video.currentTime;
  lastDetect = performance.now();

  if (view.width !== video.videoWidth || view.height !== video.videoHeight) {
    view.width = video.videoWidth;
    view.height = video.videoHeight;
  }
  vctx.drawImage(video, 0, 0, view.width, view.height);
  tracker.update(detect(detector, view, view.width, view.height));
  const tracks = tracker.visible();

  if (renderer.xr.isPresenting && source === 'headset') {
    // The passthrough already shows the room, so the boxes go into the room itself.
    head.matrixWorld.decompose(headPos, headQuat, headScale);
    headPose.compose(headPos, headQuat, unitScale);
    const target = worldBoxes.sync(tracks, headPose, view.width / view.height, gazeDistance, headPos, headDir);
    dot.material.color.set(tracks.find((t) => t.id === target)?.color ?? DOT_COLOR);
  } else {
    drawTracks(vctx, tracks, view.width, view.height);
    if (renderer.xr.isPresenting) panelTexture.needsUpdate = true;
    else present();
  }
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

// Transparent clear so the passthrough shows through in immersive-ar. The canvas itself
// is never shown: outside AR the 2D view is, and in AR the headset composites the frames.
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setClearColor(0x000000, 0);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
renderer.domElement.hidden = true;
document.body.appendChild(renderer.domElement);

const worldBoxes = new WorldBoxes(scene);

// Floating panel for the phone camera, which doesn't share the headset's viewpoint, so
// its boxes can't be placed on the real objects. Pinch or pull the trigger to move it.
const panelTexture = new THREE.CanvasTexture(view);
panelTexture.colorSpace = THREE.SRGBColorSpace;
const panel = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: panelTexture }));
panel.visible = false;
scene.add(panel);

function placePanel() {
  panel.visible = source === 'phone' && view.width > 0;
  if (!panel.visible) return;
  const width = 0.9;
  panel.scale.set(width, (width * view.height) / view.width, 1);
  panel.position.copy(headPos).addScaledVector(headDir, 1.2);
  panel.lookAt(headPos);
}

for (const i of [0, 1]) renderer.xr.getController(i).addEventListener('select', placePanel);

// --- Gaze dot ---------------------------------------------------------------

const DOT_COLOR = 0xff2020;
const dot = new THREE.Sprite(new THREE.SpriteMaterial({ map: circleTexture(), color: DOT_COLOR, depthTest: false }));
dot.renderOrder = 10;
scene.add(dot);

let hitTestSource = null;
let gazeDistance = CONFIG.boxDistance;
const head = renderer.xr.getCamera();
const headPos = new THREE.Vector3();
const headDir = new THREE.Vector3();
const headQuat = new THREE.Quaternion();
const headScale = new THREE.Vector3();
const headPose = new THREE.Matrix4();
const unitScale = new THREE.Vector3(1, 1, 1);
const hitMatrix = new THREE.Matrix4();

function updateGaze(frame) {
  head.getWorldPosition(headPos);
  head.getWorldDirection(headDir);

  let hit = false;
  if (frame && hitTestSource) {
    const pose = frame.getHitTestResults(hitTestSource)[0]?.getPose(renderer.xr.getReferenceSpace());
    if (pose) {
      hitMatrix.fromArray(pose.transform.matrix);
      dot.position.setFromMatrixPosition(hitMatrix);
      gazeDistance = THREE.MathUtils.clamp(dot.position.distanceTo(headPos), 0.3, 5);
      hit = true;
    }
  }
  if (!hit) {
    gazeDistance = CONFIG.boxDistance;
    dot.position.copy(headPos).addScaledVector(headDir, gazeDistance);
  }
  dot.scale.setScalar(gazeDistance * DOT_SIZE);
}

// --- Calibration ------------------------------------------------------------

// The headset camera sits a little off from your eyes and its exact field of view isn't
// exposed, so the right thumbstick tunes both live: left/right = FOV, up/down = pitch.
const readout = makeTextSprite();
scene.add(readout.sprite);
let readoutUntil = 0;
let calibrated = false;

function updateCalibration(frame, dt) {
  const now = performance.now();
  for (const input of frame?.session.inputSources ?? []) {
    if (input.handedness !== 'right' || !input.gamepad) continue;
    const [, , ax = 0, ay = 0] = input.gamepad.axes;
    if (Math.abs(ax) < 0.3 && Math.abs(ay) < 0.3) continue;
    CONFIG.cameraHFov = THREE.MathUtils.clamp(CONFIG.cameraHFov + ax * dt * 15, 40, 120);
    CONFIG.cameraPitch = THREE.MathUtils.clamp(CONFIG.cameraPitch - ay * dt * 10, -30, 30);
    readout.set(`camera FOV ${CONFIG.cameraHFov.toFixed(1)}°  pitch ${CONFIG.cameraPitch.toFixed(1)}°`);
    readoutUntil = now + 2000;
    calibrated = true;
  }
  readout.sprite.visible = now < readoutUntil;
  if (readout.sprite.visible) {
    readout.sprite.position.copy(headPos).addScaledVector(headDir, 1);
    readout.sprite.position.y -= 0.25;
    readout.sprite.scale.set(0.4, 0.1, 1);
  } else if (calibrated) {
    calibrated = false;
    try {
      localStorage.setItem(
        CALIBRATION_KEY,
        JSON.stringify({ cameraHFov: CONFIG.cameraHFov, cameraPitch: CONFIG.cameraPitch }),
      );
    } catch {}
  }
}

// --- AR session -------------------------------------------------------------

// Quest 3 passthrough: an immersive-ar session with floor-level tracking. hit-test places
// the gaze dot on the room's surfaces (needs Space Setup on the headset). No dom-overlay:
// Quest doesn't support it, so everything in AR is drawn in 3D.
const arButton = $('start-ar');
navigator.xr?.isSessionSupported('immersive-ar').then((ok) => {
  arButton.disabled = !ok;
  if (!ok) arButton.textContent = 'AR not supported on this device';
});
if (!navigator.xr) arButton.textContent = 'WebXR not available (needs HTTPS and a WebXR browser)';

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
  panel.visible = false;
  worldBoxes.clear();
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
renderer.setAnimationLoop((time, frame) => {
  const now = performance.now();
  const dt = (now - lastTime) / 1000;
  lastTime = now;
  if (renderer.xr.isPresenting) {
    renderer.render(scene, camera); // also updates the head pose used below
    updateGaze(frame);
    updateCalibration(frame, dt);
    // Place the phone panel once there's a head pose and a picture.
    if (source === 'phone' && !panel.visible) placePanel();
  }
  runDetection();
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
  return {
    sprite,
    set(text) {
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.font = 'bold 72px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const w = ctx.measureText(text).width + 64;
      ctx.fillStyle = 'rgba(0,0,0,.7)';
      ctx.fillRect((c.width - w) / 2, 48, w, 160);
      ctx.fillStyle = '#fff';
      ctx.fillText(text, c.width / 2, 128);
      texture.needsUpdate = true;
    },
  };
}
