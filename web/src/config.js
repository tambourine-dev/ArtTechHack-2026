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

  // AR: only the boxes are shown over the passthrough. In setup mode (A button) the camera
  // picture appears half-transparent, to line the boxes up with the room.
  arShowCamera: false,   // true = also show the camera picture outside setup mode
  // Where the boxes sit in your view. Tuned live in setup mode, remembered on the headset.
  cameraHFov: 72,        // horizontal field of view the picture covers, in degrees
  cameraYaw: 0,          // degrees the picture is shifted right (+) or left (-)
  cameraPitch: 0,        // degrees the picture is shifted up (+) or down (-)
  // How old a camera frame is when it arrives. The boxes are turned by how far your head
  // has moved since the frame was taken, so they stay on things while you look around.
  cameraLatencyMs: 80,
};
