// Tuning knobs. The detection and box settings are ported from object_recog/index.html.
export const CONFIG = {
  score: 0.4,            // minimum confidence (0..1). Lower = more boxes, higher = cleaner
  maxResults: 25,
  minAreaFrac: 0.0006,   // ignore boxes smaller than this fraction of the picture (removes specks)
  ignore: [],            // categories to hide, e.g. ["person", "chair"]
  only: [],              // if not empty, show ONLY these categories, e.g. ["cup", "bottle"]
  showScore: false,      // true = "cup 87%"
  smoothing: 0.45,       // how fast boxes follow movement (0..1): higher = snappier, lower = steadier
  confirmFrames: 2,      // a box must be seen this many times before it appears (stops flicker)
  keepFrames: 5,         // a box stays this many frames after the object disappears
  matchIou: 0.3,         // how much a new detection must overlap an old box to be "the same object"
  lineWidth: 3,          // box thickness, in pixels of a 640 px wide picture
  palette: ['#66ff44', '#ff33ff', '#2b2bff', '#ffee33', '#33aaff', '#ff9933', '#33ffcc', '#ff4466', '#aa66ff', '#ccff33'],
  detectEveryMs: 100,    // at most this often; each detection briefly blocks rendering

  // Quest 3 headset camera, used to place the boxes in the room. Both can be tuned live in AR
  // with the right thumbstick (left/right = FOV, up/down = pitch) and are remembered.
  cameraHFov: 72,        // horizontal field of view of the camera image, in degrees
  cameraPitch: 0,        // degrees the camera looks up (+) or down (-) relative to your view
  boxDistance: 1.5,      // metres, when the gaze hit-test hasn't found a surface
};

export const PEER_PREFIX = 'handpoint-'; // must match public/phone-sender.html
