// Detection boxes placed in the room instead of on a screen. Each box is projected from
// the camera picture into a rectangle facing the head pose at the moment the frame was
// captured, so it stays on the real object when you turn your head, rather than trailing
// behind like a head-locked overlay.
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { drawTag, measureTag, tagText } from './draw.js';

const unitPlane = new THREE.PlaneGeometry(1, 1);
const barMaterials = new Map();
const pitch = new THREE.Matrix4();
const inverse = new THREE.Matrix4();
const localOrigin = new THREE.Vector3();
const localDir = new THREE.Vector3();

function barMaterial(color) {
  if (!barMaterials.has(color)) {
    barMaterials.set(color, new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true }));
  }
  return barMaterials.get(color);
}

export class WorldBoxes {
  #items = new Map(); // track id → { group, bars, label, pose, distance, rect }

  constructor(scene) {
    this.root = new THREE.Group();
    scene.add(this.root);
  }

  // Shows the given tracks. Tracks seen in this frame (missed === 0) are re-anchored at
  // `pose` (the head's world matrix when the frame was captured), `distance` metres away;
  // the others stay where they were last seen. Returns the id of the box the gaze ray
  // (gazeOrigin, gazeDir) points at, the smallest one if several overlap.
  sync(tracks, pose, aspect, distance, gazeOrigin, gazeDir) {
    const seen = new Set();
    for (const t of tracks) {
      seen.add(t.id);
      const item = this.#items.get(t.id) ?? this.#create(t);
      if (t.missed === 0) {
        item.pose.copy(pose);
        item.distance = distance;
      }
      this.#layout(item, t, aspect);
    }
    for (const id of this.#items.keys()) if (!seen.has(id)) this.#remove(id);
    return this.#lookedAt(gazeOrigin, gazeDir);
  }

  clear() {
    for (const id of [...this.#items.keys()]) this.#remove(id);
  }

  #create(t) {
    const group = new THREE.Group();
    group.matrixAutoUpdate = false;
    const bars = Array.from({ length: 4 }, () => {
      const bar = new THREE.Mesh(unitPlane, barMaterial(t.color));
      bar.renderOrder = 5;
      group.add(bar);
      return bar;
    });
    const label = new THREE.Mesh(
      unitPlane,
      new THREE.MeshBasicMaterial({ depthTest: false, transparent: true }),
    );
    label.renderOrder = 6;
    group.add(label);
    this.root.add(group);
    const item = { group, bars, label, text: null, pose: new THREE.Matrix4(), distance: 1, rect: null };
    this.#items.set(t.id, item);
    return item;
  }

  #remove(id) {
    const item = this.#items.get(id);
    this.root.remove(item.group);
    item.label.material.map?.dispose();
    item.label.material.dispose();
    this.#items.delete(id);
  }

  #layout(item, t, aspect) {
    pitch.makeRotationX(THREE.MathUtils.degToRad(CONFIG.cameraPitch));
    item.group.matrix.copy(item.pose).multiply(pitch);
    item.group.matrixWorldNeedsUpdate = true;

    // Image coordinates → a rectangle on the plane `d` metres in front of the camera.
    const d = item.distance;
    const tx = Math.tan(THREE.MathUtils.degToRad(CONFIG.cameraHFov) / 2);
    const ty = tx / aspect;
    const left = (2 * t.x - 1) * tx * d;
    const right = (2 * (t.x + t.w) - 1) * tx * d;
    const top = (1 - 2 * t.y) * ty * d;
    const bottom = (1 - 2 * (t.y + t.h)) * ty * d;
    item.rect = { left, right, top, bottom, d, area: (right - left) * (top - bottom) };

    // One pixel of a 640 px wide picture, so sizes match the 2D view.
    const px = (2 * tx * d) / 640;
    const lw = CONFIG.lineWidth * px;
    const [topBar, bottomBar, leftBar, rightBar] = item.bars;
    const cx = (left + right) / 2;
    const cy = (top + bottom) / 2;
    topBar.position.set(cx, top, -d);
    topBar.scale.set(right - left + lw, lw, 1);
    bottomBar.position.set(cx, bottom, -d);
    bottomBar.scale.set(right - left + lw, lw, 1);
    leftBar.position.set(left, cy, -d);
    leftBar.scale.set(lw, top - bottom + lw, 1);
    rightBar.position.set(right, cy, -d);
    rightBar.scale.set(lw, top - bottom + lw, 1);

    // Tag on top of the box, drawn at 4× the 2D view's resolution to stay sharp.
    const fs = 17;
    const text = tagText(t);
    if (text !== item.text) this.#drawLabel(item, text, fs, t.color);
    const { width, height } = item.labelSize;
    item.label.scale.set(width * px, height * px, 1);
    item.label.position.set(left - lw / 2 + (width * px) / 2, top + lw / 2 + (height * px) / 2, -d);
  }

  #drawLabel(item, text, fs, color) {
    const scale = 4;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const size = measureTag(ctx, text, fs);
    canvas.width = Math.ceil(size.width * scale);
    canvas.height = Math.ceil(size.height * scale);
    ctx.scale(scale, scale);
    drawTag(ctx, text, 0, 0, fs, color);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    item.label.material.map?.dispose();
    item.label.material.map = texture;
    item.label.material.needsUpdate = true;
    item.text = text;
    item.labelSize = size;
  }

  #lookedAt(origin, dir) {
    let best = null;
    for (const [id, item] of this.#items) {
      const { rect } = item;
      inverse.copy(item.group.matrix).invert();
      localOrigin.copy(origin).applyMatrix4(inverse);
      localDir.copy(dir).transformDirection(inverse);
      if (localDir.z >= 0) continue; // the box's plane is behind the gaze
      const s = (-rect.d - localOrigin.z) / localDir.z;
      const x = localOrigin.x + localDir.x * s;
      const y = localOrigin.y + localDir.y * s;
      const inside = x >= rect.left && x <= rect.right && y >= rect.bottom && y <= rect.top;
      if (inside && (!best || rect.area < best.area)) best = { id, area: rect.area };
    }
    return best?.id ?? null;
  }
}
