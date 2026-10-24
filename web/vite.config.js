import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// The TTS service (tts/) runs on plain HTTP on localhost. Proxying it keeps the page's
// requests same-origin HTTPS, so the headset doesn't block them as mixed content.
const proxy = {
  '/tts': {
    target: 'http://127.0.0.1:8880',
    rewrite: (path) => path.replace(/^\/tts/, ''),
  },
};

// WebXR only runs in a secure context, so the headset needs HTTPS to reach the dev server
// over the local network. `host: true` exposes the server on the LAN.
export default defineConfig({
  plugins: [basicSsl()],
  server: { host: true, proxy },
  preview: { host: true, proxy },
});
