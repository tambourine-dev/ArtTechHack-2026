# TTS service

Local text-to-speech for the WebXR client, using [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) through [kokoro-onnx](https://github.com/thewh1teagle/kokoro-onnx). It runs on the CPU, so it doesn't need ROCm or any GPU setup.

## Setup (Fedora)

```bash
cd tts
./setup.sh          # installs uv via dnf if missing, the Python deps, and the model files (~350 MB)
uv run server.py    # serves on http://127.0.0.1:8880
```

Then start the web client as usual (`cd web && npm run dev`). Vite proxies `/tts/*` to this service, so the headset only ever talks to the HTTPS dev server.

To let the headset reach the dev server through Fedora's firewall:

```bash
sudo firewall-cmd --add-port=5173/tcp                # until reboot
sudo firewall-cmd --add-port=5173/tcp --permanent    # keep it
```

Port 8880 doesn't need to be opened, because the service only listens on localhost.

## Use from the client

```js
import { speak } from './tts.js';

// The first call must come from a user gesture (a click, or a controller 'select' in XR).
controller.addEventListener('select', () => speak('Your gaze lingered here for three seconds.'));
speak('Hello.', { voice: 'am_adam', speed: 1.1 });
```

## API

- `GET /voices`: the list of voice names. `af_*` and `am_*` are American female and male voices, `bf_*` and `bm_*` British. `af_heart` and `af_bella` are among the best.
- `POST /speak` with `{ "text": "...", "voice": "af_heart", "speed": 1.0, "lang": "en-us" }`: streams raw 16-bit mono PCM, one chunk per sentence. The `X-Sample-Rate` header gives the rate (24000).

## Options

- `KOKORO_MODEL=kokoro-v1.0.int8.onnx`: a quantised model, about 4× smaller, with slightly lower quality. Set it for both `./setup.sh` and `uv run server.py`.
- `TTS_PORT=8880`: the port. If you change it, also change the proxy target in `web/vite.config.js`.

Kokoro speaks English, Spanish, French, Italian, Portuguese, Hindi, Japanese and Chinese. It has no German.
