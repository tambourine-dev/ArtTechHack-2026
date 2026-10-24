// Tuning knobs. The detection and box settings are ported from object_recog/index.html.
export const CONFIG = {
  score: 0.4,            // minimum confidence (0..1). Lower = more boxes, higher = cleaner
  maxResults: 25,
  minAreaFrac: 0.0006,   // ignore boxes smaller than this fraction of the picture (removes specks)
  ignore: [],            // categories to hide, e.g. ["person", "chair"]
  only: [],              // if not empty, show ONLY these categories, e.g. ["cup", "bottle"]
  showScore: false,      // true = "cup 87%"
  model: 'lite0',        // 'lite0' (fast, ~3x quicker) or 'lite2' (more accurate, what object_recog uses)
  detectWidth: 640,      // the camera picture is scaled to this width before detection
  smoothing: 0.75,       // how fast boxes follow movement (0..1): higher = snappier, lower = steadier
  confirmFrames: 1,      // a box must be seen this many times before it appears (stops flicker)
  keepFrames: 3,         // a box stays this many frames after the object disappears
  matchIou: 0.3,         // how much a new detection must overlap an old box to be "the same object"
  lineWidth: 3,          // box thickness, in pixels of a 640 px wide picture
  palette: ['#66ff44', '#ff33ff', '#2b2bff', '#ffee33', '#33aaff', '#ff9933', '#33ffcc', '#ff4466', '#aa66ff', '#ccff33'],
  detectEveryMs: 0,      // minimum time between detections; 0 = every new camera frame

  // AR: the camera picture with the boxes is shown as a flat image over the passthrough.
  arShowCamera: true,    // false = only the boxes over the passthrough (they won't line up exactly)
  // Where the picture sits in your view. Tuned live in calibration (A button), remembered.
  cameraHFov: 72,        // horizontal field of view the picture covers, in degrees
  cameraYaw: 0,          // degrees the picture is shifted right (+) or left (-)
  cameraPitch: 0,        // degrees the picture is shifted up (+) or down (-)
};
