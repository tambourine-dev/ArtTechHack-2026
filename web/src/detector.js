// Object detection with MediaPipe's EfficientDet (80 COCO classes: person, cup, chair,
// laptop, ...), set up like object_recog.
import { FilesetResolver, ObjectDetector } from '@mediapipe/tasks-vision';
import { CONFIG } from './config.js';

// The wasm files must match the npm package version.
const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL = (name) =>
  `https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_${name}/float16/1/efficientdet_${name}.tflite`;

export async function createDetector() {
  const fileset = await FilesetResolver.forVisionTasks(WASM);
  const make = (delegate) =>
    ObjectDetector.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL(CONFIG.model), delegate },
      runningMode: 'VIDEO',
      scoreThreshold: CONFIG.score,
      maxResults: CONFIG.maxResults,
    });
  try {
    return await make('GPU');
  } catch {
    return make('CPU');
  }
}

// Runs the detector on one frame and returns the boxes in normalised coordinates (0..1),
// filtered by the CONFIG settings.
export function detect(detector, image, width, height) {
  const { detections } = detector.detectForVideo(image, performance.now());
  return detections
    .map((d) => ({
      x: d.boundingBox.originX / width,
      y: d.boundingBox.originY / height,
      w: d.boundingBox.width / width,
      h: d.boundingBox.height / height,
      name: d.categories[0].categoryName,
      score: d.categories[0].score,
    }))
    .filter((d) => d.w * d.h >= CONFIG.minAreaFrac)
    .filter((d) => !CONFIG.ignore.includes(d.name))
    .filter((d) => !CONFIG.only.length || CONFIG.only.includes(d.name));
}
