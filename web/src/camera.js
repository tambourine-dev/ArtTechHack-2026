// The device's own camera: a phone's back camera, or on Quest 3/3S (Horizon OS v76+) the
// front passthrough camera, behind the "headset cameras" permission. The permission prompt
// can't appear inside an immersive session, so call this before entering AR.
export async function startCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 960 } },
    audio: false,
  });
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  await video.play();
  // three.js sizes video textures from width/height, which are 0 unless set.
  video.width = video.videoWidth;
  video.height = video.videoHeight;
  return video;
}
