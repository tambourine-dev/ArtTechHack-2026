// Camera sources for the detector: the Quest's own passthrough camera, or a phone that
// streams its camera over WebRTC (the object_recog setup, via public/phone-sender.html).
import { Peer } from 'peerjs';
import { PEER_PREFIX } from './config.js';

function videoElement() {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  return video;
}

// Quest 3/3S (Horizon OS v76+) exposes the front passthrough camera through getUserMedia,
// behind the "headset cameras" permission. The prompt can't appear inside an immersive
// session, so call this before entering AR.
export async function startHeadsetCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 960 } },
    audio: false,
  });
  const video = videoElement();
  video.srcObject = stream;
  await video.play();
  return video;
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from({ length: 4 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');

// Waits for phone-sender.html to call in. onCode receives the pairing code and the link
// to open on the phone; the returned video plays the phone's camera once it connects.
export function startPhoneReceiver({ onCode, onConnected, onDisconnected, onError }) {
  const video = videoElement();
  const start = () => {
    const code = newCode();
    const peer = new Peer(PEER_PREFIX + code);
    peer.on('open', () => onCode(code, `${new URL('phone-sender.html', location.href).href}?code=${code}`));
    peer.on('error', (e) => {
      if (e.type === 'unavailable-id') {
        peer.destroy();
        start();
      } else onError(e);
    });
    peer.on('call', (call) => {
      call.answer();
      call.on('stream', (stream) => {
        video.srcObject = stream;
        video.play().catch(() => {});
        onConnected();
      });
      call.on('close', onDisconnected);
    });
  };
  start();
  return video;
}
