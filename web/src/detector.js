// Object recognition on the headset's passthrough camera, using MediaPipe's
// EfficientDet-Lite0 (the 80 COCO classes: person, cup, chair, laptop, ...).
//
// On Quest 3 the browser exposes the passthrough cameras through getUserMedia
// (Horizon OS v76+, the "headset cameras" permission). The permission prompt can't
// appear inside an immersive session, so startCamera() has to run before entering AR.
import { FilesetResolver, ObjectDetector } from '@mediapipe/tasks-vision';

// The wasm files must match the npm package version.
const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL =
  'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite';

export async function startCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } },
    audio: false,
  });
  const video = document.createElement('video');
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await video.play();
  return video;
}

// The CPU delegate keeps MediaPipe off the WebGL context that the XR renderer is using.
export async function createDetector({ scoreThreshold = 0.4, maxResults = 6 } = {}) {
  const fileset = await FilesetResolver.forVisionTasks(WASM);
  return ObjectDetector.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL, delegate: 'CPU' },
    runningMode: 'VIDEO',
    scoreThreshold,
    maxResults,
  });
}

// Runs the detector a few times per second and hands each result to onResult.
// Detection blocks the main thread for a moment, so it runs on its own timer instead
// of every render frame; the Quest compositor keeps passthrough smooth in between.
export function runDetection(detector, video, onResult, intervalMs = 250) {
  let stopped = false;
  const tick = () => {
    if (stopped) return;
    if (video.readyState >= 2) {
      const { detections } = detector.detectForVideo(video, performance.now());
      onResult(
        detections.map((d) => ({
          label: d.categories[0].categoryName,
          score: d.categories[0].score,
          box: d.boundingBox, // { originX, originY, width, height } in video pixels
        })),
      );
    }
    setTimeout(tick, intervalMs);
  };
  tick();
  return () => (stopped = true);
}
