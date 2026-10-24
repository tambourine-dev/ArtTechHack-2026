// Tuning knobs. The detection and box settings are ported from object_recog/index.html,
// the faces and glitch settings from object_face_facemesh_glitch/index.html.
export const CONFIG = {
  // Objects
  objects: true,
  objectEvery: 2,        // run object detection every N camera frames (faces run on every frame)
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

  // Faces + expressions
  faces: true,
  maxFaces: 6,
  showPercent: true,     // "happy 82%"
  emotionSmoothing: 0.35,// how fast the expression reacts (0..1): higher = faster, lower = steadier
  minEmotion: 0.3,       // below this strength the face is called "neutral"
  // Sensitivity per expression: raise a number if that expression is under-detected, lower it if it triggers too easily
  gain: { happy: 1.6, sad: 1.8, angry: 1.5, surprised: 1.3 },

  // Face mesh (M key)
  mesh: true,
  meshOpacity: 0.35,     // brightness of the full 468-point wireframe (0..1)
  meshDots: true,        // draw a dot on every landmark; the dots swell when the expression changes
  meshGlow: true,        // glow on the eyes, brows, lips and face outline

  // Glitch effect (G key, or Y on the left controller in AR). Applied to what you see only,
  // never to what the models analyse. In AR it affects the boxes and mesh, not the passthrough.
  glitch: {
    on: true,
    base: 0.12,          // constant background glitch (0..1)
    intensity: 1,        // master multiplier: 0.5 = tamer, 2 = chaos
    slices: true,        // horizontal bands that jump sideways
    scanlines: true,     // dark CRT lines
    noise: true,         // flashing cyan/magenta blocks
  },

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
