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
//
// `--mode http` (npm run dev:http) serves plain HTTP for a reverse proxy such as Caddy
// that terminates TLS. The proxy forwards its own domain as the Host header, which Vite
// rejects by default, so list it in ALLOWED_HOSTS (comma-separated); unset allows any host.
export default defineConfig(({ mode }) => {
  const behindProxy = mode === 'http';
  const allowedHosts = process.env.ALLOWED_HOSTS?.split(',') ?? true;
  const server = { host: true, proxy, ...(behindProxy && { allowedHosts }) };

  return {
    plugins: behindProxy ? [] : [basicSsl()],
    server,
    preview: server,
  };
});
