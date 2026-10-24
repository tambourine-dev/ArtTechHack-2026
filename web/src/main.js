import * as THREE from 'three';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { createDetector, runDetection, startCamera } from './detector.js';

// Quest 3 has no eye-tracking cameras, and the Quest browser doesn't expose eye gaze to
// WebXR on any headset. The gaze dot therefore follows the head: it sits where the centre
// of your view meets a real surface (WebXR hit-test), or 1.5 m ahead if nothing is hit.
const FALLBACK_DISTANCE = 1.5;
const DOT_SIZE = 0.012; // relative to distance, so the dot keeps the same size on screen

const scene = new THREE.Scene();

// Eye height for the flat browser view; in XR the headset pose replaces this.
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 100);
camera.position.set(0, 1.6, 0);
scene.add(camera); // the HUD panel is a child of the camera

// alpha: true lets the passthrough show through in immersive-ar.
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
document.body.appendChild(renderer.domElement);
document.body.appendChild(ARButton.createButton(renderer, { optionalFeatures: ['hit-test'] }));

// --- Gaze dot ---------------------------------------------------------------

const dot = new THREE.Sprite(
  new THREE.SpriteMaterial({ map: circleTexture(), color: 0xff2020, depthTest: false }),
);
dot.renderOrder = 10;
scene.add(dot);

// Name of the object you're looking at, shown just above the dot.
const gazeLabel = makeTextSprite();
scene.add(gazeLabel.sprite);

let hitTestSource = null;
renderer.xr.addEventListener('sessionstart', async () => {
  const session = renderer.xr.getSession();
  if (!session.requestHitTestSource) return;
  const viewer = await session.requestReferenceSpace('viewer');
  hitTestSource = await session.requestHitTestSource({ space: viewer }).catch(() => null);
});
renderer.xr.addEventListener('sessionend', () => (hitTestSource = null));

const headPos = new THREE.Vector3();
const headDir = new THREE.Vector3();
const hitMatrix = new THREE.Matrix4();

function updateGaze(frame) {
  const head = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  head.getWorldPosition(headPos);
  head.getWorldDirection(headDir);

  let hit = false;
  if (frame && hitTestSource) {
    const results = frame.getHitTestResults(hitTestSource);
    const pose = results[0]?.getPose(renderer.xr.getReferenceSpace());
    if (pose) {
      hitMatrix.fromArray(pose.transform.matrix);
      dot.position.setFromMatrixPosition(hitMatrix);
      hit = true;
    }
  }
  if (!hit) dot.position.copy(headPos).addScaledVector(headDir, FALLBACK_DISTANCE);

  const distance = dot.position.distanceTo(headPos);
  dot.scale.setScalar(distance * DOT_SIZE);
  gazeLabel.sprite.position.copy(dot.position);
  gazeLabel.sprite.position.y += distance * 0.04;
  gazeLabel.sprite.scale.set(distance * 0.16, distance * 0.04, 1);
}

// --- Object recognition -----------------------------------------------------

// Small panel at the lower right of the view: the camera image with the detections.
const hudCanvas = document.createElement('canvas');
hudCanvas.width = 640;
hudCanvas.height = 480;
const hudCtx = hudCanvas.getContext('2d');
const hudTexture = new THREE.CanvasTexture(hudCanvas);
hudTexture.colorSpace = THREE.SRGBColorSpace;
const hud = new THREE.Mesh(
  new THREE.PlaneGeometry(0.24, 0.18),
  new THREE.MeshBasicMaterial({ map: hudTexture, transparent: true, opacity: 0.9, depthTest: false }),
);
hud.position.set(0.22, -0.18, -0.6);
hud.renderOrder = 9;
hud.visible = false;
camera.add(hud);

// The detector runs on the camera image, but the gaze ray points through the centre of
// the view. The passthrough camera roughly faces the same way, so the object whose box
// contains the image centre is taken as the one you're looking at.
function lookedAt(detections, width, height) {
  const cx = width / 2;
  const cy = height / 2;
  const inside = detections.filter(
    ({ box: b }) => cx >= b.originX && cx <= b.originX + b.width && cy >= b.originY && cy <= b.originY + b.height,
  );
  // The smallest box that contains the centre is the most specific guess.
  return inside.sort((a, b) => a.box.width * a.box.height - b.box.width * b.box.height)[0];
}

function drawHud(video, detections, target) {
  const { width, height } = hudCanvas;
  const sx = width / video.videoWidth;
  const sy = height / video.videoHeight;
  hudCtx.drawImage(video, 0, 0, width, height);
  hudCtx.lineWidth = 4;
  hudCtx.font = 'bold 26px system-ui, sans-serif';
  for (const d of detections) {
    const { originX, originY, width: w, height: h } = d.box;
    hudCtx.strokeStyle = hudCtx.fillStyle = d === target ? '#ff2020' : '#22ff66';
    hudCtx.strokeRect(originX * sx, originY * sy, w * sx, h * sy);
    hudCtx.fillText(`${d.label} ${Math.round(d.score * 100)}%`, originX * sx + 6, originY * sy + 28);
  }
  // Crosshair for the image centre, i.e. roughly where the gaze dot points.
  hudCtx.strokeStyle = '#ff2020';
  hudCtx.beginPath();
  hudCtx.arc(width / 2, height / 2, 8, 0, Math.PI * 2);
  hudCtx.stroke();
  hudTexture.needsUpdate = true;
}

const status = document.createElement('button');
status.textContent = 'Enable camera (before entering AR)';
status.style.cssText =
  'position:absolute;top:20px;left:50%;transform:translateX(-50%);padding:12px 18px;' +
  'border:1px solid #fff;border-radius:4px;background:rgba(0,0,0,.6);color:#fff;font:13px sans-serif;cursor:pointer';
document.body.appendChild(status);

status.addEventListener('click', async () => {
  status.disabled = true;
  try {
    status.textContent = 'Starting camera…';
    const video = await startCamera();
    status.textContent = 'Loading object model…';
    const detector = await createDetector();
    hud.visible = true;
    runDetection(detector, video, (detections) => {
      const target = lookedAt(detections, video.videoWidth, video.videoHeight);
      drawHud(video, detections, target);
      gazeLabel.set(target ? target.label : '');
    });
    status.textContent = 'Camera on, now enter AR';
  } catch (err) {
    console.error(err);
    status.textContent = `Camera unavailable: ${err.message}`;
    status.disabled = false;
  }
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
  c.width = 512;
  c.height = 128;
  const ctx = c.getContext('2d');
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false }));
  sprite.renderOrder = 10;
  let current = null;
  return {
    sprite,
    set(text) {
      if (text === current) return;
      current = text;
      ctx.clearRect(0, 0, c.width, c.height);
      if (text) {
        ctx.font = 'bold 64px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const w = ctx.measureText(text).width + 48;
        ctx.fillStyle = 'rgba(0,0,0,.6)';
        ctx.fillRect((c.width - w) / 2, 16, w, 96);
        ctx.fillStyle = '#fff';
        ctx.fillText(text, c.width / 2, 64);
      }
      texture.needsUpdate = true;
    },
  };
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

renderer.setAnimationLoop((time, frame) => {
  updateGaze(frame);
  renderer.render(scene, camera);
});
